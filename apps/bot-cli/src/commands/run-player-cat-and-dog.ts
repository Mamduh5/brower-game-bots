import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, JsonObject, JsonValue, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import {
  type CatAndDogAttemptDiagnostics,
  type CatAndDogAttemptFeedback,
  type CatAndDogStrategySelectionDetails,
  scoreCatAndDogAttemptFeedback,
  selectCatAndDogAttemptStrategy,
  type CatAndDogAttemptStrategy,
  type CatAndDogStrategyMode,
  createPlayerBrain
} from "@game-bots/agent-player";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import type { GameSnapshot } from "@game-bots/game-sdk";
import { CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID } from "@game-bots/cat-and-dog-web";
import { toJsonReport } from "@game-bots/reporting";
import { SystemClock } from "@game-bots/runtime-core";

import type { AppContainer } from "../bootstrap/container.js";
import { resolveGamePlugin } from "../bootstrap/game-plugins.js";
import { buildArtifactCaptureName, buildArtifactIndex } from "./run-artifact-index.js";

export type AttemptOutcome = "WIN" | "LOSS" | "UNKNOWN";
type ShotResolutionCategory =
  | "none"
  | "turn-start"
  | "aiming"
  | "windup"
  | "direct-hit"
  | "splash-hit"
  | "wall-hit"
  | "miss"
  | "heal"
  | "cpu-planning"
  | "unknown";

export interface CatAndDogAttemptRunDiagnostics extends CatAndDogAttemptDiagnostics {
  maxStepsBudget: number;
  elapsedMs: number;
  totalWaitMs: number;
  resolutionWaitMs: number;
  waitHeavyRatio: number;
  nonWaitOverheadMs: number;
  observationCount: number;
  maxUnchangedObservationCycles: number;
  stalledLoopDetected: boolean;
  stalledLoopReason: string | null;
  turnsObserved: number;
  shotResolutionsObserved: number;
  directHits: number;
  splashHits: number;
  wallHits: number;
  misses: number;
  healsObserved: number;
  damageDealt: number | null;
  damageTaken: number | null;
  hpTrackingAvailable: boolean;
  damageTrackingConfirmed: boolean;
  progressSignalSource: "hp" | "combat-hint" | "turn-only" | "unavailable";
  combatHintsObserved: number;
  instructionalHintsObserved: number;
  turnStatusHintsObserved: number;
  lastHintCategory: "none" | "instructional" | "turn-status" | "combat-result" | "cpu-planning" | "unknown";
  lastCombatHintText: string | null;
  playerHpStart: number | null;
  playerHpEnd: number | null;
  cpuHpStart: number | null;
  cpuHpEnd: number | null;
}

export interface CatAndDogPlayerAttemptRecord {
  attemptNumber: number;
  startedAt: string;
  endedAt: string;
  outcome: AttemptOutcome;
  assessment: string;
  note: string;
  strategy: CatAndDogAttemptStrategy;
  strategySelectionReason: string;
  strategySelectionDetails: CatAndDogStrategySelectionDetails;
  diagnostics: CatAndDogAttemptRunDiagnostics;
  actionHistory: readonly JsonObject[];
  finalState: JsonObject;
  artifacts: readonly ArtifactRef[];
}

export interface CatAndDogPlayerRunOptions {
  maxAttempts?: number;
  stopOnWin?: boolean;
  strategyMode?: CatAndDogStrategyMode;
  maxStepsPerAttempt?: number;
}

export interface PlayerCatAndDogRunResult {
  run: RunRecord;
  events: readonly RunEvent[];
  report: RunReport;
  attempts: readonly CatAndDogPlayerAttemptRecord[];
  artifacts: readonly ArtifactRef[];
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_STEPS_PER_ATTEMPT = 32;
const GAMEPLAY_PROGRESS_EXTENSION_STEPS = 4;
const SHOT_PROGRESS_EXTENSION_STEPS = 8;

function isTerminalPhase(phase: RunRecord["phase"]): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

function buildObservationPayload(
  frame: { payload: JsonObject } & { summary?: string | undefined },
  snapshot: GameSnapshot
) {
  return {
    ...frame.payload,
    gameSnapshotTitle: snapshot.title,
    gameSnapshotTerminal: snapshot.isTerminal,
    gameSemanticState: snapshot.semanticState,
    gameMetrics: snapshot.metrics,
    ...(frame.summary ? { frameSummary: frame.summary } : {})
  };
}

function byArtifactPath(left: ArtifactRef, right: ArtifactRef): number {
  return left.relativePath.localeCompare(right.relativePath);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)])) as JsonObject;
  }

  return String(value);
}

function buildAttemptCaptureName(attemptNumber: number, step: number, label: string): string {
  return `attempt-${String(attemptNumber).padStart(2, "0")}/${buildArtifactCaptureName(step, label)}`;
}

function buildAttemptFeedback(attempt: CatAndDogPlayerAttemptRecord): CatAndDogAttemptFeedback {
  return {
    attemptNumber: attempt.attemptNumber,
    outcome: attempt.outcome,
    strategy: attempt.strategy,
    diagnostics: {
      semanticActionCount: attempt.diagnostics.semanticActionCount,
      shotsFired: attempt.diagnostics.shotsFired,
      waitActions: attempt.diagnostics.waitActions,
      gameplayEnteredObserved: attempt.diagnostics.gameplayEnteredObserved,
      playerTurnReadyObserved: attempt.diagnostics.playerTurnReadyObserved,
      endOverlayObserved: attempt.diagnostics.endOverlayObserved,
      stepBudgetReached: attempt.diagnostics.stepBudgetReached,
      turnsObserved: attempt.diagnostics.turnsObserved,
      shotResolutionsObserved: attempt.diagnostics.shotResolutionsObserved,
      directHits: attempt.diagnostics.directHits,
      splashHits: attempt.diagnostics.splashHits,
      wallHits: attempt.diagnostics.wallHits,
      misses: attempt.diagnostics.misses,
      healsObserved: attempt.diagnostics.healsObserved,
      damageDealt: attempt.diagnostics.damageDealt,
      damageTaken: attempt.diagnostics.damageTaken
    }
  };
}

function scoreAttemptRecord(attempt: CatAndDogPlayerAttemptRecord): number {
  return scoreCatAndDogAttemptFeedback(buildAttemptFeedback(attempt));
}

function readSemanticNumber(snapshot: GameSnapshot, key: string): number | null {
  const value = snapshot.semanticState[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readShotResolutionCategory(snapshot: GameSnapshot): ShotResolutionCategory {
  const value = snapshot.semanticState.shotResolutionCategory;
  return typeof value === "string" ? (value as ShotResolutionCategory) : "none";
}

function buildResolutionSignature(snapshot: GameSnapshot): string | null {
  if (snapshot.semanticState.shotResolved !== true) {
    return null;
  }

  return [
    snapshot.semanticState.turnCounter ?? "",
    snapshot.semanticState.shotResolutionCategory ?? "",
    snapshot.semanticState.canvasHintText ?? ""
  ].join("|");
}

function buildCombatHintSignature(snapshot: GameSnapshot): string | null {
  if (
    snapshot.semanticState.canvasHintVisible !== true ||
    snapshot.semanticState.canvasHintCategory !== "combat-result" ||
    typeof snapshot.semanticState.canvasHintText !== "string"
  ) {
    return null;
  }

  return [
    snapshot.semanticState.turnCounter ?? "",
    snapshot.semanticState.canvasHintText.trim()
  ].join("|");
}

function buildHintSignature(snapshot: GameSnapshot): string | null {
  if (snapshot.semanticState.canvasHintVisible !== true || typeof snapshot.semanticState.canvasHintText !== "string") {
    return null;
  }

  return [
    snapshot.semanticState.turnCounter ?? "",
    snapshot.semanticState.canvasHintCategory ?? "",
    snapshot.semanticState.canvasHintText.trim()
  ].join("|");
}

function detectAttemptOutcome(snapshot: GameSnapshot): AttemptOutcome | null {
  const outcome = snapshot.semanticState.outcome;
  if (outcome === "win") {
    return "WIN";
  }

  if (outcome === "loss") {
    return "LOSS";
  }

  if (snapshot.isTerminal === true || snapshot.semanticState.endVisible === true) {
    return "UNKNOWN";
  }

  return null;
}

function summarizeFinalState(snapshot: GameSnapshot): JsonObject {
  return {
    status: toJsonValue(snapshot.semanticState.status),
    routePath: toJsonValue(snapshot.semanticState.routePath),
    gameplayEntered: toJsonValue(snapshot.semanticState.gameplayEntered),
    menuVisible: toJsonValue(snapshot.semanticState.menuVisible),
    cpuSetupVisible: toJsonValue(snapshot.semanticState.cpuSetupVisible),
    playerTurnReady: toJsonValue(snapshot.semanticState.playerTurnReady),
    turnBannerVisible: toJsonValue(snapshot.semanticState.turnBannerVisible),
    turnBannerLabelText: toJsonValue(snapshot.semanticState.turnBannerLabelText),
    selectedWeaponKey: toJsonValue(snapshot.semanticState.selectedWeaponKey),
    modeLabelText: toJsonValue(snapshot.semanticState.modeLabelText),
    matchNoteText: toJsonValue(snapshot.semanticState.matchNoteText),
    canvasHintVisible: toJsonValue(snapshot.semanticState.canvasHintVisible),
    canvasHintText: toJsonValue(snapshot.semanticState.canvasHintText),
    canvasHintCategory: toJsonValue(snapshot.semanticState.canvasHintCategory),
    playerHpValue: toJsonValue(snapshot.semanticState.playerHpValue),
    playerHpMax: toJsonValue(snapshot.semanticState.playerHpMax),
    cpuHpValue: toJsonValue(snapshot.semanticState.cpuHpValue),
    cpuHpMax: toJsonValue(snapshot.semanticState.cpuHpMax),
    hpTrackingAvailable: toJsonValue(snapshot.semanticState.hpTrackingAvailable),
    progressSignalSource: toJsonValue(snapshot.semanticState.progressSignalSource),
    turnCounter: toJsonValue(snapshot.semanticState.turnCounter),
    shotResolutionCategory: toJsonValue(snapshot.semanticState.shotResolutionCategory),
    shotResolved: toJsonValue(snapshot.semanticState.shotResolved),
    endVisible: toJsonValue(snapshot.semanticState.endVisible),
    endTitleText: toJsonValue(snapshot.semanticState.endTitleText),
    endSubtitleText: toJsonValue(snapshot.semanticState.endSubtitleText),
    outcome: toJsonValue(snapshot.semanticState.outcome)
  };
}

function buildAttemptAssessment(
  outcome: AttemptOutcome,
  diagnostics: CatAndDogAttemptRunDiagnostics
): string {
  if (outcome === "WIN") {
    return "won-round";
  }

  if (outcome === "LOSS" && (diagnostics.damageDealt ?? 0) > 0) {
    return "loss-with-damage";
  }

  if (outcome === "LOSS") {
    return "loss-without-progress";
  }

  if (diagnostics.stalledLoopDetected) {
    return "stalled-loop";
  }

  if (diagnostics.shotsFired === 0) {
    return "setup-stalled";
  }

  if (diagnostics.shotResolutionsObserved === 0) {
    return "resolution-stalled";
  }

  if ((diagnostics.damageDealt ?? 0) > 0 || diagnostics.directHits > 0 || diagnostics.splashHits > 0) {
    return "progress-without-terminal";
  }

  return "inconclusive";
}

function buildAttemptNote(snapshot: GameSnapshot, fallback: string): string {
  if (snapshot.semanticState.endTitleText && typeof snapshot.semanticState.endTitleText === "string") {
    return snapshot.semanticState.endTitleText;
  }

  if (snapshot.semanticState.matchNoteText && typeof snapshot.semanticState.matchNoteText === "string") {
    return snapshot.semanticState.matchNoteText;
  }

  return fallback;
}

function buildObservationFingerprint(snapshot: GameSnapshot): string {
  return [
    snapshot.semanticState.turnCounter ?? "",
    snapshot.semanticState.playerTurnReady === true ? "ready" : "blocked",
    snapshot.semanticState.turnBannerVisible === true ? "banner" : "clear",
    snapshot.semanticState.shotResolved === true ? "resolved" : "unresolved",
    snapshot.semanticState.shotResolutionCategory ?? "",
    snapshot.semanticState.canvasHintCategory ?? "",
    snapshot.semanticState.canvasHintText ?? "",
    snapshot.semanticState.matchNoteText ?? "",
    snapshot.semanticState.outcome ?? "",
    snapshot.semanticState.endVisible === true ? "end" : "live"
  ].join("|");
}

function detectStallReason(input: {
  snapshot: GameSnapshot;
  diagnostics: CatAndDogAttemptRunDiagnostics;
  decisionActionId: string;
  unchangedObservationCycles: number;
}): string | null {
  const { snapshot, diagnostics, decisionActionId, unchangedObservationCycles } = input;
  if (
    snapshot.semanticState.endVisible === true ||
    snapshot.semanticState.outcome === "win" ||
    snapshot.semanticState.outcome === "loss"
  ) {
    return null;
  }

  if (
    diagnostics.shotsFired > diagnostics.shotResolutionsObserved &&
    snapshot.semanticState.playerTurnReady !== true &&
    unchangedObservationCycles >= 2
  ) {
    return "unresolved-shot-loop";
  }

  if (
    decisionActionId === "wait-for-turn-resolution" &&
    snapshot.semanticState.playerTurnReady !== true &&
    unchangedObservationCycles >= 3 &&
    (
      snapshot.semanticState.turnBannerVisible === true ||
      snapshot.semanticState.canvasHintCategory === "cpu-planning" ||
      snapshot.semanticState.canvasHintCategory === "turn-status" ||
      snapshot.semanticState.shotResolved === true
    )
  ) {
    return "turn-resolution-loop";
  }

  return null;
}

function buildStallNote(reason: string, attemptNumber: number): string {
  switch (reason) {
    case "unresolved-shot-loop":
      return `Attempt ${attemptNumber} stalled after a shot without visible resolution progress.`;
    case "turn-resolution-loop":
      return `Attempt ${attemptNumber} remained in a non-productive turn-resolution loop without reaching a terminal state.`;
    default:
      return `Attempt ${attemptNumber} stalled in a non-productive gameplay loop.`;
  }
}

function createAttemptDiagnostics(maxStepsBudget: number): CatAndDogAttemptRunDiagnostics {
  return {
    semanticActionCount: 0,
    shotsFired: 0,
    waitActions: 0,
    gameplayEnteredObserved: false,
    playerTurnReadyObserved: false,
    endOverlayObserved: false,
    stepBudgetReached: false,
    maxStepsBudget,
    elapsedMs: 0,
    totalWaitMs: 0,
    resolutionWaitMs: 0,
    waitHeavyRatio: 0,
    nonWaitOverheadMs: 0,
    observationCount: 0,
    maxUnchangedObservationCycles: 0,
    stalledLoopDetected: false,
    stalledLoopReason: null,
    turnsObserved: 0,
    shotResolutionsObserved: 0,
    directHits: 0,
    splashHits: 0,
    wallHits: 0,
    misses: 0,
    healsObserved: 0,
    damageDealt: null,
    damageTaken: null,
    hpTrackingAvailable: false,
    damageTrackingConfirmed: false,
    progressSignalSource: "unavailable",
    combatHintsObserved: 0,
    instructionalHintsObserved: 0,
    turnStatusHintsObserved: 0,
    lastHintCategory: "none",
    lastCombatHintText: null,
    playerHpStart: null,
    playerHpEnd: null,
    cpuHpStart: null,
    cpuHpEnd: null
  };
}

function updateAttemptDiagnostics(
  diagnostics: CatAndDogAttemptRunDiagnostics,
  snapshot: GameSnapshot
): CatAndDogAttemptRunDiagnostics {
  return {
    ...diagnostics,
    observationCount: diagnostics.observationCount + 1,
    gameplayEnteredObserved:
      diagnostics.gameplayEnteredObserved || snapshot.semanticState.gameplayEntered === true,
    playerTurnReadyObserved:
      diagnostics.playerTurnReadyObserved || snapshot.semanticState.playerTurnReady === true,
    endOverlayObserved: diagnostics.endOverlayObserved || snapshot.semanticState.endVisible === true
  };
}

function updateAttemptProgressFromSnapshot(
  diagnostics: CatAndDogAttemptRunDiagnostics,
  snapshot: GameSnapshot,
  input: {
    lastResolutionSignature: string | null;
    lastHintSignature: string | null;
    lastCombatHintSignature: string | null;
    previousPlayerTurnReady: boolean;
  }
): {
  diagnostics: CatAndDogAttemptRunDiagnostics;
  lastResolutionSignature: string | null;
  lastHintSignature: string | null;
  lastCombatHintSignature: string | null;
  previousPlayerTurnReady: boolean;
} {
  let nextDiagnostics = updateAttemptDiagnostics(diagnostics, snapshot);
  const playerHpValue = readSemanticNumber(snapshot, "playerHpValue");
  const cpuHpValue = readSemanticNumber(snapshot, "cpuHpValue");
  const semanticProgressSignalSource = snapshot.semanticState.progressSignalSource;

  if (nextDiagnostics.playerHpStart === null && playerHpValue !== null) {
    nextDiagnostics = {
      ...nextDiagnostics,
      playerHpStart: playerHpValue
    };
  }

  if (nextDiagnostics.cpuHpStart === null && cpuHpValue !== null) {
    nextDiagnostics = {
      ...nextDiagnostics,
      cpuHpStart: cpuHpValue
    };
  }

  if (playerHpValue !== null) {
    nextDiagnostics = {
      ...nextDiagnostics,
      playerHpEnd: playerHpValue
    };
  }

  if (cpuHpValue !== null) {
    nextDiagnostics = {
      ...nextDiagnostics,
      cpuHpEnd: cpuHpValue
    };
  }

  if (nextDiagnostics.playerHpStart !== null && nextDiagnostics.playerHpEnd !== null) {
    nextDiagnostics = {
      ...nextDiagnostics,
      damageTaken: Math.max(0, nextDiagnostics.playerHpStart - nextDiagnostics.playerHpEnd)
    };
  }

  if (nextDiagnostics.cpuHpStart !== null && nextDiagnostics.cpuHpEnd !== null) {
    nextDiagnostics = {
      ...nextDiagnostics,
      damageDealt: Math.max(0, nextDiagnostics.cpuHpStart - nextDiagnostics.cpuHpEnd)
    };
  }

  const hpTrackingAvailable =
    nextDiagnostics.hpTrackingAvailable ||
    snapshot.semanticState.hpTrackingAvailable === true ||
    playerHpValue !== null ||
    cpuHpValue !== null;
  const damageTrackingConfirmed =
    ((nextDiagnostics.playerHpStart !== null && nextDiagnostics.playerHpEnd !== null) ||
      (nextDiagnostics.cpuHpStart !== null && nextDiagnostics.cpuHpEnd !== null));
  const progressSignalSource =
    hpTrackingAvailable
      ? "hp"
      : semanticProgressSignalSource === "combat-hint" || nextDiagnostics.shotResolutionsObserved > 0
        ? "combat-hint"
        : semanticProgressSignalSource === "turn-only" || nextDiagnostics.turnsObserved > 0
          ? "turn-only"
          : "unavailable";
  nextDiagnostics = {
    ...nextDiagnostics,
    hpTrackingAvailable,
    damageTrackingConfirmed,
    progressSignalSource
  };

  if (snapshot.semanticState.playerTurnReady === true && input.previousPlayerTurnReady !== true) {
    nextDiagnostics = {
      ...nextDiagnostics,
      turnsObserved: nextDiagnostics.turnsObserved + 1
    };
  }

  const resolutionSignature = buildResolutionSignature(snapshot);
  if (resolutionSignature && resolutionSignature !== input.lastResolutionSignature) {
    const category = readShotResolutionCategory(snapshot);
    nextDiagnostics = {
      ...nextDiagnostics,
      shotResolutionsObserved: nextDiagnostics.shotResolutionsObserved + 1,
      ...(category === "direct-hit" ? { directHits: nextDiagnostics.directHits + 1 } : {}),
      ...(category === "splash-hit" ? { splashHits: nextDiagnostics.splashHits + 1 } : {}),
      ...(category === "wall-hit" ? { wallHits: nextDiagnostics.wallHits + 1 } : {}),
      ...(category === "miss" ? { misses: nextDiagnostics.misses + 1 } : {}),
      ...(category === "heal" ? { healsObserved: nextDiagnostics.healsObserved + 1 } : {})
    };
  }

  const hintSignature = buildHintSignature(snapshot);
  if (hintSignature && hintSignature !== input.lastHintSignature) {
    const hintCategory = snapshot.semanticState.canvasHintCategory;
    nextDiagnostics = {
      ...nextDiagnostics,
      ...(hintCategory === "instructional"
        ? { instructionalHintsObserved: nextDiagnostics.instructionalHintsObserved + 1 }
        : {}),
      ...(hintCategory === "turn-status"
        ? { turnStatusHintsObserved: nextDiagnostics.turnStatusHintsObserved + 1 }
        : {}),
      ...(hintCategory === "combat-result"
        ? { combatHintsObserved: nextDiagnostics.combatHintsObserved + 1 }
        : {}),
      lastHintCategory:
        hintCategory === "instructional" ||
        hintCategory === "turn-status" ||
        hintCategory === "combat-result" ||
        hintCategory === "cpu-planning" ||
        hintCategory === "unknown"
          ? hintCategory
          : "none"
    };
  }

  const combatHintSignature = buildCombatHintSignature(snapshot);
  if (combatHintSignature && combatHintSignature !== input.lastCombatHintSignature) {
    nextDiagnostics = {
      ...nextDiagnostics,
      lastCombatHintText:
        typeof snapshot.semanticState.canvasHintText === "string" ? snapshot.semanticState.canvasHintText : null
    };
  }

  return {
    diagnostics: nextDiagnostics,
    lastResolutionSignature: resolutionSignature ?? input.lastResolutionSignature,
    lastHintSignature: hintSignature ?? input.lastHintSignature,
    lastCombatHintSignature: combatHintSignature ?? input.lastCombatHintSignature,
    previousPlayerTurnReady: snapshot.semanticState.playerTurnReady === true
  };
}

function buildPlayerSummaryJson(input: {
  run: RunRecord;
  report: RunReport;
  attempts: readonly CatAndDogPlayerAttemptRecord[];
  options: Required<Pick<CatAndDogPlayerRunOptions, "maxAttempts" | "stopOnWin" | "strategyMode">>;
  artifacts: readonly ArtifactRef[];
}): JsonObject {
  const winningAttempt = input.attempts.find((attempt) => attempt.outcome === "WIN") ?? null;
  const mostProgressiveAttempt =
    [...input.attempts]
      .sort(
        (left, right) =>
          scoreAttemptRecord(right) - scoreAttemptRecord(left) || right.attemptNumber - left.attemptNumber
      )[0] ?? null;
  const rankedAttemptVariants = [...input.attempts]
    .sort(
      (left, right) =>
        scoreAttemptRecord(right) - scoreAttemptRecord(left) || right.attemptNumber - left.attemptNumber
    )
    .slice(0, 3)
    .map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      outcome: attempt.outcome,
      assessment: attempt.assessment,
      score: scoreAttemptRecord(attempt),
      strategySelectionReason: attempt.strategySelectionReason,
      strategy: toJsonValue(attempt.strategy)
    }));

  return {
    run: {
      runId: input.run.runId,
      gameId: input.run.gameId,
      profileId: input.run.profileId ?? "",
      phase: input.run.phase,
      status: input.run.status,
      createdAt: input.run.createdAt,
      updatedAt: input.run.updatedAt
    },
    summary: {
      attemptsRun: input.attempts.length,
      maxAttempts: input.options.maxAttempts,
      stopOnWin: input.options.stopOnWin,
      strategyMode: input.options.strategyMode,
      hadWin: Boolean(winningAttempt),
      unknownAttempts: input.attempts.filter((attempt) => attempt.outcome === "UNKNOWN").length,
      terminalAttempts: input.attempts.filter((attempt) => attempt.outcome !== "UNKNOWN").length,
      ...(winningAttempt ? { winningAttemptNumber: winningAttempt.attemptNumber } : {}),
      ...(winningAttempt ? { winningAttemptStrategy: toJsonValue(winningAttempt.strategy) } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptNumber: mostProgressiveAttempt.attemptNumber } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptStrategy: toJsonValue(mostProgressiveAttempt.strategy) } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptAssessment: mostProgressiveAttempt.assessment } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptScore: scoreAttemptRecord(mostProgressiveAttempt) } : {}),
      reportId: input.report.reportId,
      artifactCount: input.artifacts.length
    },
    strategyInsights: {
      rankedAttemptVariants
    },
    attempts: input.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      outcome: attempt.outcome,
      assessment: attempt.assessment,
      note: attempt.note,
      strategy: toJsonValue(attempt.strategy),
      strategySelectionReason: attempt.strategySelectionReason,
      strategySelectionDetails: toJsonValue(attempt.strategySelectionDetails),
      diagnostics: toJsonValue(attempt.diagnostics),
      actionHistory: toJsonValue(attempt.actionHistory),
      finalState: toJsonValue(attempt.finalState),
      artifacts: attempt.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        relativePath: artifact.relativePath,
        createdAt: artifact.createdAt
      }))
    }))
  };
}

export async function runPlayerCatAndDog(
  container: AppContainer,
  options: CatAndDogPlayerRunOptions = {}
): Promise<PlayerCatAndDogRunResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const stopOnWin = options.stopOnWin ?? true;
  const strategyMode = options.strategyMode ?? "baseline";
  const maxStepsPerAttempt = options.maxStepsPerAttempt ?? DEFAULT_MAX_STEPS_PER_ATTEMPT;
  const plugin = resolveGamePlugin("cat-and-dog-web");
  const brain = createPlayerBrain();
  const environmentPort = new PlaywrightEnvironmentPort({
    artifactStore: container.artifactStore
  });
  const clock = new SystemClock();

  const request: RunRequest = {
    agentKind: "player",
    gameId: plugin.manifest.gameId,
    environmentId: environmentPort.environmentId,
    profileId: CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID,
    config: {
      maxAttempts,
      stopOnWin,
      strategyMode,
      maxStepsPerAttempt
    }
  };

  let run = await container.runEngine.createRun(request);
  const logger = container.logger.child({
    runId: run.runId,
    agentKind: request.agentKind,
    gameId: request.gameId,
    profileId: request.profileId
  });
  const environmentSession = await environmentPort.openSession();
  const capturedArtifacts: ArtifactRef[] = [];
  const attempts: CatAndDogPlayerAttemptRecord[] = [];
  let report: RunReport | null = null;

  const storeArtifactEvent = async (artifact: ArtifactRef): Promise<void> => {
    capturedArtifacts.push(artifact);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: artifact.createdAt,
      type: "artifact.stored",
      artifact
    });
  };

  const captureAttemptArtifact = async (
    attemptNumber: number,
    step: number,
    label: string,
    kind: "screenshot" | "dom-snapshot"
  ): Promise<ArtifactRef> => {
    const artifact = await environmentSession.capture({
      kind,
      name: buildAttemptCaptureName(attemptNumber, step, label)
    });
    await storeArtifactEvent(artifact);
    return artifact;
  };

  logger.info({ maxAttempts, stopOnWin, strategyMode }, "Starting cat-and-dog player run.");

  try {
    await brain.initialize({ run });

    run = await container.runEngine.transitionPhase(run, "preparing");
    run = await container.runEngine.transitionPhase(run, "environment_starting");
    await environmentSession.start({
      runId: run.runId,
      headless: true,
      viewport: {
        width: 1280,
        height: 720
      }
    });

    run = await container.runEngine.transitionPhase(run, "game_bootstrap");
    run = await container.runEngine.transitionPhase(run, "executing");

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
      const strategySelection = selectCatAndDogAttemptStrategy({
        attemptNumber,
        strategyMode,
        history: attempts.map((attempt) => buildAttemptFeedback(attempt))
      });
      const {
        strategy,
        selectionReason: strategySelectionReason,
        selectionDetails: strategySelectionDetails
      } = strategySelection;
      const attemptArtifacts: ArtifactRef[] = [];
      const attemptStartedAt = clock.now().toISOString();
      const attemptStartedAtMs = Date.parse(attemptStartedAt);
      const attemptLogger = logger.child({
        attemptNumber,
        strategyMode,
        strategy,
        strategySelectionReason
      });
      const gameSession = await plugin.createSession(
        request.profileId
          ? {
              profileId: request.profileId
            }
          : {}
      );

      await container.runEngine.appendEvent({
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: attemptStartedAt,
        type: "observation.captured",
        observationKind: "attempt.started",
        summary: `Starting attempt ${attemptNumber}.`,
        payload: {
          attemptNumber,
          strategy: toJsonValue(strategy),
          strategyMode,
          strategySelectionReason,
          strategySelectionDetails: toJsonValue(strategySelectionDetails)
        }
      });

      await gameSession.bootstrap(environmentSession);

      const openingFrame = await environmentSession.observe({
        modes: ["dom"]
      });
      let currentSnapshot = await gameSession.translate(openingFrame);
      const openingObservationEvent: RunEvent = {
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: clock.now().toISOString(),
        type: "observation.captured",
        observationKind: "opening",
        summary: `Attempt ${attemptNumber} opening state.`,
        payload: buildObservationPayload(openingFrame, currentSnapshot)
      };
      await container.runEngine.appendEvent(openingObservationEvent);

      attemptArtifacts.push(
        await captureAttemptArtifact(attemptNumber, 10, "pre-gameplay-screen", "screenshot")
      );

      const actionHistory: JsonObject[] = [];
      let postEntryCaptured = false;
      let endStateCaptured = false;
      let outcome: AttemptOutcome = "UNKNOWN";
      let note = `Attempt ${attemptNumber} reached the step budget without a terminal outcome.`;
      let maxStepsBudget = maxStepsPerAttempt;
      let diagnostics = createAttemptDiagnostics(maxStepsBudget);
      let lastResolutionSignature: string | null = null;
      let lastHintSignature: string | null = null;
      let lastCombatHintSignature: string | null = null;
      let previousPlayerTurnReady = false;
      let lastObservationFingerprint = buildObservationFingerprint(currentSnapshot);
      let unchangedObservationCycles = 0;
      ({
        diagnostics,
        lastResolutionSignature,
        lastHintSignature,
        lastCombatHintSignature,
        previousPlayerTurnReady
      } = updateAttemptProgressFromSnapshot(diagnostics, currentSnapshot, {
        lastResolutionSignature,
        lastHintSignature,
        lastCombatHintSignature,
        previousPlayerTurnReady
      }));

      for (let step = 1; step <= maxStepsBudget; step += 1) {
        const detectedOutcome = detectAttemptOutcome(currentSnapshot);
        if (detectedOutcome) {
          outcome = detectedOutcome;
          note = buildAttemptNote(currentSnapshot, `Attempt ${attemptNumber} reached a terminal state.`);
          break;
        }

        const availableActions = await gameSession.actions(currentSnapshot);
        const decision = await brain.decide({
          run,
          gameState: {
            title: currentSnapshot.title,
            isTerminal: currentSnapshot.isTerminal,
            ...currentSnapshot.semanticState
          },
          availableActions,
          recentEvents: await container.runEngine.listEvents(run.runId)
        });

        if (decision.type === "complete") {
          note = decision.reason;
          break;
        }

        if (decision.type !== "game-action") {
          throw new Error(`Expected a semantic game action, received ${decision.type}.`);
        }

        diagnostics = {
          ...diagnostics,
          semanticActionCount: diagnostics.semanticActionCount + 1,
          ...(decision.actionId === "execute-planned-shot"
            ? { shotsFired: diagnostics.shotsFired + 1 }
            : {}),
          ...(decision.actionId === "wait-for-turn-resolution"
            ? { waitActions: diagnostics.waitActions + 1 }
            : {})
        };

        actionHistory.push({
          step,
          actionId: decision.actionId,
          ...(decision.params ? { params: toJsonValue(decision.params) } : {})
        });

        const environmentActions = await gameSession.resolveAction(
          {
            actionId: decision.actionId,
            params: decision.params
          },
          currentSnapshot
        );

        for (const environmentAction of environmentActions) {
          if (environmentAction.kind === "wait") {
            diagnostics = {
              ...diagnostics,
              totalWaitMs: diagnostics.totalWaitMs + environmentAction.durationMs,
              ...(decision.actionId === "wait-for-turn-resolution"
                ? {
                    resolutionWaitMs: diagnostics.resolutionWaitMs + environmentAction.durationMs
                  }
                : {})
            };
          }

          const actionResult = await environmentSession.execute(environmentAction);
          await container.runEngine.appendEvent({
            eventId: randomUUID(),
            runId: run.runId,
            sequence: await container.runEngine.nextSequence(run.runId),
            timestamp: actionResult.completedAt,
            type: "action.executed",
            actionKind: environmentAction.kind,
            status: actionResult.status,
            summary: actionResult.detail,
            payload: {
              action: environmentAction.kind,
              semanticActionId: decision.actionId,
              ...(decision.params ? { semanticActionParams: toJsonValue(decision.params) } : {}),
              ...actionResult.payload
            }
          });
        }

        const postActionFrame = await environmentSession.observe({
          modes: ["dom"]
        });
        currentSnapshot = await gameSession.translate(postActionFrame);
        ({
          diagnostics,
          lastResolutionSignature,
          lastHintSignature,
          lastCombatHintSignature,
          previousPlayerTurnReady
        } = updateAttemptProgressFromSnapshot(diagnostics, currentSnapshot, {
          lastResolutionSignature,
          lastHintSignature,
          lastCombatHintSignature,
          previousPlayerTurnReady
        }));
        const observationFingerprint = buildObservationFingerprint(currentSnapshot);
        unchangedObservationCycles =
          observationFingerprint === lastObservationFingerprint ? unchangedObservationCycles + 1 : 0;
        lastObservationFingerprint = observationFingerprint;
        diagnostics = {
          ...diagnostics,
          maxUnchangedObservationCycles: Math.max(
            diagnostics.maxUnchangedObservationCycles,
            unchangedObservationCycles
          )
        };
        await container.runEngine.appendEvent({
          eventId: randomUUID(),
          runId: run.runId,
          sequence: await container.runEngine.nextSequence(run.runId),
          timestamp: clock.now().toISOString(),
          type: "observation.captured",
          observationKind: "post-action",
          summary: `Attempt ${attemptNumber} post-action state.`,
          payload: buildObservationPayload(postActionFrame, currentSnapshot)
        });

        if (!postEntryCaptured && currentSnapshot.semanticState.gameplayEntered === true) {
          attemptArtifacts.push(
            await captureAttemptArtifact(attemptNumber, 20, "post-entry-screen", "screenshot")
          );
          postEntryCaptured = true;
          maxStepsBudget = Math.max(maxStepsBudget, maxStepsPerAttempt + GAMEPLAY_PROGRESS_EXTENSION_STEPS);
          diagnostics = {
            ...diagnostics,
            maxStepsBudget
          };
        }

        if (diagnostics.shotsFired > 0 && currentSnapshot.semanticState.endVisible !== true) {
          maxStepsBudget = Math.max(maxStepsBudget, maxStepsPerAttempt + SHOT_PROGRESS_EXTENSION_STEPS);
          diagnostics = {
            ...diagnostics,
            maxStepsBudget
          };
        }

        const postActionOutcome = detectAttemptOutcome(currentSnapshot);
        if (postActionOutcome && !endStateCaptured) {
          attemptArtifacts.push(
            await captureAttemptArtifact(attemptNumber, 30, "end-state-screen", "screenshot")
          );
          if (postActionOutcome === "WIN" || postActionOutcome === "LOSS") {
            attemptArtifacts.push(
              await captureAttemptArtifact(attemptNumber, 40, "outcome-screen", "screenshot")
            );
          }
          endStateCaptured = true;
          outcome = postActionOutcome;
          note = buildAttemptNote(currentSnapshot, `Attempt ${attemptNumber} reached a terminal state.`);
          break;
        }

        const stallReason = detectStallReason({
          snapshot: currentSnapshot,
          diagnostics,
          decisionActionId: decision.actionId,
          unchangedObservationCycles
        });
        if (stallReason) {
          diagnostics = {
            ...diagnostics,
            stalledLoopDetected: true,
            stalledLoopReason: stallReason
          };
          note = buildStallNote(stallReason, attemptNumber);
          break;
        }
      }

      const finalDetectedOutcome = detectAttemptOutcome(currentSnapshot);
      if (finalDetectedOutcome) {
        outcome = finalDetectedOutcome;
        note = buildAttemptNote(currentSnapshot, note);
      }

      if (!postEntryCaptured && currentSnapshot.semanticState.gameplayEntered === true) {
        attemptArtifacts.push(
          await captureAttemptArtifact(attemptNumber, 20, "post-entry-screen", "screenshot")
        );
      }

      if (!endStateCaptured) {
        attemptArtifacts.push(
          await captureAttemptArtifact(attemptNumber, 30, "end-state-screen", "screenshot")
        );
        if (outcome === "WIN" || outcome === "LOSS") {
          attemptArtifacts.push(
            await captureAttemptArtifact(attemptNumber, 40, "outcome-screen", "screenshot")
          );
        }
      }

      attemptArtifacts.push(
        await captureAttemptArtifact(attemptNumber, 50, "final-state-dom", "dom-snapshot")
      );

      ({
        diagnostics,
        lastResolutionSignature,
        lastHintSignature,
        lastCombatHintSignature,
        previousPlayerTurnReady
      } = updateAttemptProgressFromSnapshot(diagnostics, currentSnapshot, {
        lastResolutionSignature,
        lastHintSignature,
        lastCombatHintSignature,
        previousPlayerTurnReady
      }));
      if (outcome === "UNKNOWN" && actionHistory.length >= maxStepsBudget) {
        diagnostics = {
          ...diagnostics,
          stepBudgetReached: true
        };
      }

      const attemptEndedAt = clock.now().toISOString();
      const elapsedMs = Math.max(
        0,
        Number.isFinite(attemptStartedAtMs) ? Date.parse(attemptEndedAt) - attemptStartedAtMs : 0
      );
      const assessment = buildAttemptAssessment(outcome, diagnostics);
      const attemptRecord: CatAndDogPlayerAttemptRecord = {
        attemptNumber,
        startedAt: attemptStartedAt,
        endedAt: attemptEndedAt,
        outcome,
        assessment,
        note,
        strategy,
        strategySelectionReason,
        strategySelectionDetails,
        diagnostics: {
          ...diagnostics,
          elapsedMs,
          nonWaitOverheadMs: Math.max(0, elapsedMs - diagnostics.totalWaitMs),
          waitHeavyRatio:
            elapsedMs > 0
              ? Number((diagnostics.totalWaitMs / elapsedMs).toFixed(3))
              : 0
        },
        actionHistory,
        finalState: summarizeFinalState(currentSnapshot),
        artifacts: [...attemptArtifacts].sort(byArtifactPath)
      };
      attempts.push(attemptRecord);

      await container.runEngine.appendEvent({
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: attemptEndedAt,
        type: "observation.captured",
        observationKind: "attempt.completed",
        summary: `Attempt ${attemptNumber} completed with ${outcome}.`,
        payload: {
          attemptNumber,
          startedAt: attemptStartedAt,
          endedAt: attemptEndedAt,
          outcome,
          assessment,
          note,
          strategy: toJsonValue(strategy),
          strategySelectionReason,
          strategySelectionDetails: toJsonValue(strategySelectionDetails),
          diagnostics: toJsonValue(attemptRecord.diagnostics),
          actionHistory: toJsonValue(actionHistory),
          finalState: summarizeFinalState(currentSnapshot),
          artifacts: attemptRecord.artifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            kind: artifact.kind,
            relativePath: artifact.relativePath
          }))
        }
      });

      attemptLogger.info(
        { outcome, assessment, note, diagnostics: attemptRecord.diagnostics },
        "Completed cat-and-dog player attempt."
      );

      if (outcome === "WIN" && stopOnWin) {
        break;
      }
    }

    run = await container.runEngine.transitionPhase(run, "evaluating");
    run = await container.runEngine.transitionPhase(run, "reporting");

    report = container.reportBuilder.build({
      run,
      findings: [],
      evidence: capturedArtifacts,
      completedAt: clock.now()
    });
    await container.runEngine.saveReport(report);

    const reportArtifact = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "report",
        relativePath: "reports/01-run-report.json",
        contentType: "application/json"
      },
      Buffer.from(toJsonReport(report), "utf8")
    );
    await storeArtifactEvent(reportArtifact);

    const playerSummary = buildPlayerSummaryJson({
      run,
      report,
      attempts,
      options: {
        maxAttempts,
        stopOnWin,
        strategyMode
      },
      artifacts: [...capturedArtifacts].sort(byArtifactPath)
    });
    const summaryArtifact = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "json",
        relativePath: "reports/02-player-attempt-summary.json",
        contentType: "application/json"
      },
      Buffer.from(JSON.stringify(playerSummary, null, 2), "utf8")
    );
    await storeArtifactEvent(summaryArtifact);

    const eventsForIndex = await container.runEngine.listEvents(run.runId);
    const artifactIndex = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "json",
        relativePath: "reports/03-artifact-index.json",
        contentType: "application/json"
      },
      Buffer.from(
        JSON.stringify(
          buildArtifactIndex({
            run,
            artifacts: [...capturedArtifacts].sort(byArtifactPath),
            findings: [],
            events: eventsForIndex
          }),
          null,
          2
        ),
        "utf8"
      )
    );
    await storeArtifactEvent(artifactIndex);

    const sortedArtifacts = [...capturedArtifacts].sort(byArtifactPath);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: clock.now().toISOString(),
      type: "report.generated",
      reportId: report.reportId,
      evidence: sortedArtifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        label: artifact.kind,
        detail: artifact.relativePath
      }))
    });

    run = await container.runEngine.completeRun(run);

    logger.info(
      {
        attemptCount: attempts.length,
        hadWin: attempts.some((attempt) => attempt.outcome === "WIN"),
        artifactCount: sortedArtifacts.length
      },
      "Completed cat-and-dog player run."
    );

    process.stdout.write(
      `Completed cat-and-dog player run ${run.runId} with ${attempts.length} attempt(s) and ${sortedArtifacts.length} artifacts.\n`
    );

    return {
      run,
      events: await container.runEngine.listEvents(run.runId),
      report,
      attempts,
      artifacts: sortedArtifacts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cat-and-dog player run failure.";
    logger.error({ err: error }, "Cat-and-dog player run failed.");

    if (!isTerminalPhase(run.phase)) {
      run = await container.runEngine.failRun(run, "player_run_failed", message);
    }

    throw error;
  } finally {
    await environmentSession.stop("cat-and-dog-player-run-finished");
    await brain.shutdown?.();
  }
}
