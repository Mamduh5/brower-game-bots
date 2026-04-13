import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, JsonObject, JsonValue, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import type { ObservationRequest } from "@game-bots/environment-sdk";
import {
  type CatAndDogAttemptDiagnostics,
  type CatAndDogAttemptFeedback,
  type CatAndDogShotExecutionPlan,
  type CatAndDogShotFeedbackRecord,
  planCatAndDogShotExecution,
  type CatAndDogStrategySelectionDetails,
  scoreCatAndDogAttemptFeedback,
  selectCatAndDogAttemptStrategy,
  type CatAndDogAttemptStrategy,
  type CatAndDogStrategyMode,
  createPlayerBrain
} from "@game-bots/agent-player";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import type { GameSnapshot } from "@game-bots/game-sdk";
import {
  buildCatAndDogObservationRequest,
  CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID
} from "@game-bots/cat-and-dog-web";
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
type VisionShotOutcomeLabel =
  | "none"
  | "no-meaningful-visual-change"
  | "self-side-impact"
  | "short"
  | "blocked"
  | "near-target"
  | "target-side-impact"
  | "long"
  | "unknown";

export interface CatAndDogAttemptRunDiagnostics extends CatAndDogAttemptDiagnostics {
  maxStepsBudget: number;
  elapsedMs: number;
  totalWaitMs: number;
  resolutionWaitMs: number;
  waitHeavyRatio: number;
  nonWaitOverheadMs: number;
  observationCaptureMs: number;
  snapshotTranslationMs: number;
  actionExecutionMs: number;
  artifactCaptureMs: number;
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
  visionAvailableObserved: boolean;
  visionChangeSignals: number;
  visionStrongChangeSignals: number;
  visionTargetSideSignals: number;
  visionTerrainSideSignals: number;
  visionNoChangeShots: number;
  visionNearTargetShots: number;
  visionBlockedShots: number;
  visionShortShots: number;
  visionLongShots: number;
  visionSelfSideShots: number;
  lastVisionChangeStrength: "none" | "subtle" | "strong" | "unknown";
  lastVisionImpactCategory:
    | "none"
    | "target-side-activity"
    | "terrain-or-midfield-activity"
    | "self-side-activity"
    | "unknown";
  lastVisionShotOutcomeLabel: VisionShotOutcomeLabel;
  lastVisionShotOutcomeConfidence: "low" | "medium" | "unknown";
  lastVisionShotOutcomeSource: "diff-only" | "anchor-assisted" | "unavailable";
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
  runtimeStateAvailable: boolean;
  runtimeStateSource: "fixture-hook" | "game-instance" | "error" | "unavailable";
  windValue: number | null;
  windNormalized: number | null;
  windDirection: "left" | "right" | "calm" | "unknown";
  projectileLabel: string | null;
  projectileWeight: number | null;
  projectileLaunchSpeedMultiplier: number | null;
  projectileGravityMultiplier: number | null;
  projectileWindInfluenceMultiplier: number | null;
  projectileSplashRadius: number | null;
  projectileDamageMin: number | null;
  projectileDamageMax: number | null;
  projectileWindupSeconds: number | null;
  preparedShotAngle: number | null;
  preparedShotPower: number | null;
  preparedShotKey: string | null;
  plannedShots: number;
  uniqueShotFingerprints: number;
  repeatedShotPlans: number;
  shotFamilySwitches: number;
  meaningfulShotFeedbacks: number;
  nonProductiveShots: number;
  strongestFailedFamily: string | null;
  strongestFailedShotSequence: string | null;
  meaningfulAdaptationObserved: boolean;
  familyExhaustions: number;
  deadPathAbortReason: string | null;
  strongestDeadPathSequence: string | null;
  unknownTerminationKind: "none" | "dead-path-protection" | "step-budget-exhausted" | "ambiguous-final-state";
}

export interface CatAndDogShotRecord {
  shotNumber: number;
  plannedAt: string;
  resolvedAt: string;
  family: string;
  category: string;
  source: string;
  fingerprint: string;
  familySwitchReason: string | null;
  projectilePolicyReason: string | null;
  adaptationReason: string | null;
  inputsUsed: readonly string[];
  strategy: JsonObject;
  feedback: JsonObject;
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
  shotHistory: readonly CatAndDogShotRecord[];
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
  const payload = { ...frame.payload };
  delete payload.primaryCanvasPngBase64;

  return {
    ...payload,
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
      visionChangeSignals: attempt.diagnostics.visionChangeSignals,
      visionStrongChangeSignals: attempt.diagnostics.visionStrongChangeSignals,
      visionTargetSideSignals: attempt.diagnostics.visionTargetSideSignals,
      visionTerrainSideSignals: attempt.diagnostics.visionTerrainSideSignals,
      visionNoChangeShots: attempt.diagnostics.visionNoChangeShots,
      visionNearTargetShots: attempt.diagnostics.visionNearTargetShots,
      visionBlockedShots: attempt.diagnostics.visionBlockedShots,
      visionShortShots: attempt.diagnostics.visionShortShots,
      visionLongShots: attempt.diagnostics.visionLongShots,
      visionSelfSideShots: attempt.diagnostics.visionSelfSideShots,
      lastVisionShotOutcomeLabel: attempt.diagnostics.lastVisionShotOutcomeLabel,
      damageDealt: attempt.diagnostics.damageDealt,
      damageTaken: attempt.diagnostics.damageTaken,
      runtimeStateAvailable: attempt.diagnostics.runtimeStateAvailable,
      windValue: attempt.diagnostics.windValue,
      windNormalized: attempt.diagnostics.windNormalized,
      windDirection: attempt.diagnostics.windDirection,
      projectileLabel: attempt.diagnostics.projectileLabel,
      projectileWeight: attempt.diagnostics.projectileWeight,
      projectileLaunchSpeedMultiplier: attempt.diagnostics.projectileLaunchSpeedMultiplier,
      projectileGravityMultiplier: attempt.diagnostics.projectileGravityMultiplier,
      projectileWindInfluenceMultiplier: attempt.diagnostics.projectileWindInfluenceMultiplier,
      projectileSplashRadius: attempt.diagnostics.projectileSplashRadius,
      projectileDamageMin: attempt.diagnostics.projectileDamageMin,
      projectileDamageMax: attempt.diagnostics.projectileDamageMax,
      projectileWindupSeconds: attempt.diagnostics.projectileWindupSeconds,
      preparedShotAngle: attempt.diagnostics.preparedShotAngle,
      preparedShotPower: attempt.diagnostics.preparedShotPower,
      preparedShotKey: attempt.diagnostics.preparedShotKey
    },
    ...(attempt.strategySelectionDetails.plannerFamily && attempt.strategySelectionDetails.plannerCategory
      ? {
          planner: {
            family: attempt.strategySelectionDetails.plannerFamily,
            category: attempt.strategySelectionDetails.plannerCategory,
            switchReason: attempt.strategySelectionDetails.plannerFamilySwitchReason
          }
        }
      : {})
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

function isTrue(value: unknown): boolean {
  return value === true;
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

function hasTriedFallbackFamily(shotHistory: readonly CatAndDogShotRecord[]): boolean {
  return new Set(shotHistory.map((shot) => shot.family)).size >= 2;
}

function getFailureEvidenceWeight(shot: CatAndDogShotRecord): number {
  const visionOnlyDirectionalFailure =
    shot.feedback.shotResolved !== true &&
    (shot.feedback.shotResolutionCategory === null || shot.feedback.shotResolutionCategory === "none") &&
    (
      shot.feedback.visualOutcomeLabel === "self-side-impact" ||
      shot.feedback.visualOutcomeLabel === "blocked" ||
      shot.feedback.visualOutcomeLabel === "short" ||
      shot.feedback.visualOutcomeLabel === "long" ||
      shot.feedback.visualOutcomeLabel === "no-meaningful-visual-change"
    );

  return visionOnlyDirectionalFailure ? 0.35 : 1;
}

function isResolvedFailureShot(shot: CatAndDogShotRecord): boolean {
  const visualOutcomeLabel = shot.feedback.visualOutcomeLabel;
  const shotResolutionCategory = shot.feedback.shotResolutionCategory;

  return (
    shot.feedback.familyFailed === true &&
    getFailureEvidenceWeight(shot) >= 1 &&
    (
      shot.feedback.shotResolved === true ||
      visualOutcomeLabel === "blocked" ||
      visualOutcomeLabel === "self-side-impact" ||
      visualOutcomeLabel === "short" ||
      visualOutcomeLabel === "long" ||
      shotResolutionCategory === "wall-hit" ||
      shotResolutionCategory === "miss"
    )
  );
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
    runtimeStateAvailable: toJsonValue(snapshot.semanticState.runtimeStateAvailable),
    runtimeStateSource: toJsonValue(snapshot.semanticState.runtimeStateSource),
    windValue: toJsonValue(snapshot.semanticState.windValue),
    windNormalized: toJsonValue(snapshot.semanticState.windNormalized),
    windDirection: toJsonValue(snapshot.semanticState.windDirection),
    projectileLabel: toJsonValue(snapshot.semanticState.projectileLabel),
    projectileWeight: toJsonValue(snapshot.semanticState.projectileWeight),
    projectileLaunchSpeedMultiplier: toJsonValue(snapshot.semanticState.projectileLaunchSpeedMultiplier),
    projectileGravityMultiplier: toJsonValue(snapshot.semanticState.projectileGravityMultiplier),
    projectileWindInfluenceMultiplier: toJsonValue(snapshot.semanticState.projectileWindInfluenceMultiplier),
    projectileSplashRadius: toJsonValue(snapshot.semanticState.projectileSplashRadius),
    projectileDamageMin: toJsonValue(snapshot.semanticState.projectileDamageMin),
    projectileDamageMax: toJsonValue(snapshot.semanticState.projectileDamageMax),
    projectileWindupSeconds: toJsonValue(snapshot.semanticState.projectileWindupSeconds),
    preparedShotAngle: toJsonValue(snapshot.semanticState.preparedShotAngle),
    preparedShotPower: toJsonValue(snapshot.semanticState.preparedShotPower),
    preparedShotKey: toJsonValue(snapshot.semanticState.preparedShotKey),
    turnCounter: toJsonValue(snapshot.semanticState.turnCounter),
    shotResolutionCategory: toJsonValue(snapshot.semanticState.shotResolutionCategory),
    shotResolved: toJsonValue(snapshot.semanticState.shotResolved),
    visionAvailable: toJsonValue(snapshot.semanticState.visionAvailable),
    visionChangeRatio: toJsonValue(snapshot.semanticState.visionChangeRatio),
    visionChangeStrength: toJsonValue(snapshot.semanticState.visionChangeStrength),
    visionChangeFocus: toJsonValue(snapshot.semanticState.visionChangeFocus),
    visionPlayerAnchorXRatio: toJsonValue(snapshot.semanticState.visionPlayerAnchorXRatio),
    visionPlayerAnchorYRatio: toJsonValue(snapshot.semanticState.visionPlayerAnchorYRatio),
    visionPlayerAnchorSource: toJsonValue(snapshot.semanticState.visionPlayerAnchorSource),
    visionEnemyAnchorXRatio: toJsonValue(snapshot.semanticState.visionEnemyAnchorXRatio),
    visionEnemyAnchorYRatio: toJsonValue(snapshot.semanticState.visionEnemyAnchorYRatio),
    visionEnemyAnchorSource: toJsonValue(snapshot.semanticState.visionEnemyAnchorSource),
    visionImpactXRatio: toJsonValue(snapshot.semanticState.visionImpactXRatio),
    visionImpactYRatio: toJsonValue(snapshot.semanticState.visionImpactYRatio),
    visionImpactRegion: toJsonValue(snapshot.semanticState.visionImpactRegion),
    visionImpactCategory: toJsonValue(snapshot.semanticState.visionImpactCategory),
    visionShotOutcomeLabel: toJsonValue(snapshot.semanticState.visionShotOutcomeLabel),
    visionShotOutcomeConfidence: toJsonValue(snapshot.semanticState.visionShotOutcomeConfidence),
    visionShotOutcomeSource: toJsonValue(snapshot.semanticState.visionShotOutcomeSource),
    endVisible: toJsonValue(snapshot.semanticState.endVisible),
    endTitleText: toJsonValue(snapshot.semanticState.endTitleText),
    endSubtitleText: toJsonValue(snapshot.semanticState.endSubtitleText),
    outcome: toJsonValue(snapshot.semanticState.outcome)
  };
}

function extractRuntimeState(snapshot: GameSnapshot): JsonObject | null {
  if (snapshot.semanticState.runtimeStateAvailable !== true) {
    return null;
  }

  return {
    runtimeStateAvailable: true,
    runtimeStateSource: toJsonValue(snapshot.semanticState.runtimeStateSource),
    windValue: toJsonValue(snapshot.semanticState.windValue),
    windNormalized: toJsonValue(snapshot.semanticState.windNormalized),
    windDirection: toJsonValue(snapshot.semanticState.windDirection),
    projectileLabel: toJsonValue(snapshot.semanticState.projectileLabel),
    projectileWeight: toJsonValue(snapshot.semanticState.projectileWeight),
    projectileLaunchSpeedMultiplier: toJsonValue(snapshot.semanticState.projectileLaunchSpeedMultiplier),
    projectileGravityMultiplier: toJsonValue(snapshot.semanticState.projectileGravityMultiplier),
    projectileWindInfluenceMultiplier: toJsonValue(snapshot.semanticState.projectileWindInfluenceMultiplier),
    projectileSplashRadius: toJsonValue(snapshot.semanticState.projectileSplashRadius),
    projectileDamageMin: toJsonValue(snapshot.semanticState.projectileDamageMin),
    projectileDamageMax: toJsonValue(snapshot.semanticState.projectileDamageMax),
    projectileWindupSeconds: toJsonValue(snapshot.semanticState.projectileWindupSeconds),
    preparedShotAngle: toJsonValue(snapshot.semanticState.preparedShotAngle),
    preparedShotPower: toJsonValue(snapshot.semanticState.preparedShotPower),
    preparedShotKey: toJsonValue(snapshot.semanticState.preparedShotKey),
    selectedWeaponKey: toJsonValue(snapshot.semanticState.selectedWeaponKey),
    turnCounter: toJsonValue(snapshot.semanticState.turnCounter)
  };
}

function extractVisionState(snapshot: GameSnapshot): JsonObject | null {
  if (snapshot.semanticState.visionAvailable !== true) {
    return null;
  }

  return {
    visionAvailable: true,
    visionChangeRatio: toJsonValue(snapshot.semanticState.visionChangeRatio),
    visionChangeStrength: toJsonValue(snapshot.semanticState.visionChangeStrength),
    visionChangeFocus: toJsonValue(snapshot.semanticState.visionChangeFocus),
    visionImpactXRatio: toJsonValue(snapshot.semanticState.visionImpactXRatio),
    visionImpactYRatio: toJsonValue(snapshot.semanticState.visionImpactYRatio),
    visionImpactRegion: toJsonValue(snapshot.semanticState.visionImpactRegion),
    visionImpactCategory: toJsonValue(snapshot.semanticState.visionImpactCategory),
    visionShotOutcomeLabel: toJsonValue(snapshot.semanticState.visionShotOutcomeLabel),
    visionShotOutcomeConfidence: toJsonValue(snapshot.semanticState.visionShotOutcomeConfidence),
    visionShotOutcomeSource: toJsonValue(snapshot.semanticState.visionShotOutcomeSource),
    visionPlayerAnchorXRatio: toJsonValue(snapshot.semanticState.visionPlayerAnchorXRatio),
    visionPlayerAnchorYRatio: toJsonValue(snapshot.semanticState.visionPlayerAnchorYRatio),
    visionEnemyAnchorXRatio: toJsonValue(snapshot.semanticState.visionEnemyAnchorXRatio),
    visionEnemyAnchorYRatio: toJsonValue(snapshot.semanticState.visionEnemyAnchorYRatio)
  };
}

function summarizeFinalStateWithContext(input: {
  snapshot: GameSnapshot;
  lastKnownGoodRuntimeState: JsonObject | null;
  lastKnownGoodVisionState: JsonObject | null;
}): JsonObject {
  return {
    ...summarizeFinalState(input.snapshot),
    finalLiveRuntimeState: extractRuntimeState(input.snapshot),
    finalLiveVisionState: extractVisionState(input.snapshot),
    lastKnownGoodRuntimeState: input.lastKnownGoodRuntimeState,
    lastKnownGoodVisionState: input.lastKnownGoodVisionState
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
    snapshot.semanticState.visionChangeStrength ?? "",
    snapshot.semanticState.visionImpactCategory ?? "",
    snapshot.semanticState.visionShotOutcomeLabel ?? "",
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
  shotHistory: readonly CatAndDogShotRecord[];
}): string | null {
  const { snapshot, diagnostics, decisionActionId, unchangedObservationCycles, shotHistory } = input;
  const fallbackFamilyTried = hasTriedFallbackFamily(shotHistory);
  const recentShots = shotHistory.slice(-4);
  const recentResolvedFailures = recentShots.filter((shot) => isResolvedFailureShot(shot));
  const sameFamilyResolvedFailures =
    recentResolvedFailures.length >= 3 &&
    recentResolvedFailures.every((shot) => shot.family === recentResolvedFailures[0]?.family);
  const repeatedBlockedOrSelfFailures =
    recentResolvedFailures.filter(
      (shot) =>
        shot.feedback.visualOutcomeLabel === "blocked" || shot.feedback.visualOutcomeLabel === "self-side-impact"
    ).length >= 2;

  if (
    snapshot.semanticState.endVisible === true ||
    snapshot.semanticState.outcome === "win" ||
    snapshot.semanticState.outcome === "loss"
  ) {
    return null;
  }

  if (
    diagnostics.shotsFired > diagnostics.shotResolutionsObserved &&
    decisionActionId === "wait-for-turn-resolution" &&
    snapshot.semanticState.playerTurnReady !== true &&
    snapshot.semanticState.visionChangeStrength !== "strong" &&
    (
      snapshot.semanticState.canvasHintCategory === "cpu-planning" ||
      snapshot.semanticState.canvasHintCategory === "turn-status" ||
      snapshot.semanticState.canvasHintCategory === "instructional" ||
      snapshot.semanticState.shotResolutionCategory === "turn-start" ||
      snapshot.semanticState.shotResolutionCategory === "aiming" ||
      snapshot.semanticState.shotResolutionCategory === "windup"
    ) &&
    unchangedObservationCycles >= (fallbackFamilyTried ? 4 : 5)
  ) {
    return "unresolved-shot-loop";
  }

  if (
    decisionActionId === "wait-for-turn-resolution" &&
    fallbackFamilyTried &&
    snapshot.semanticState.playerTurnReady !== true &&
    unchangedObservationCycles >= 5 &&
    (
      snapshot.semanticState.turnBannerVisible === true ||
      snapshot.semanticState.canvasHintCategory === "cpu-planning" ||
      snapshot.semanticState.canvasHintCategory === "turn-status" ||
      snapshot.semanticState.shotResolved === true
    )
  ) {
    return "turn-resolution-loop";
  }

  if (
    fallbackFamilyTried &&
    recentResolvedFailures.length >= 3 &&
    sameFamilyResolvedFailures &&
    recentResolvedFailures.every((shot) => shot.feedback.meaningfulProgress !== true)
  ) {
    return `family-exhausted:${recentResolvedFailures[0]?.family ?? "unknown"}`;
  }

  if (
    fallbackFamilyTried &&
    recentResolvedFailures.length >= 3 &&
    recentResolvedFailures.every((shot) => shot.feedback.meaningfulProgress !== true) &&
    repeatedBlockedOrSelfFailures
  ) {
    return "dead-shot-sequence";
  }

  return null;
}

function buildStallNote(reason: string, attemptNumber: number): string {
  if (reason.startsWith("family-exhausted:")) {
    const family = reason.slice("family-exhausted:".length);
    return `Attempt ${attemptNumber} aborted after exhausting ${family} without meaningful improvement.`;
  }

  switch (reason) {
    case "unresolved-shot-loop":
      return `Attempt ${attemptNumber} stalled after a shot without visible resolution progress.`;
    case "instructional-resolution-loop":
      return `Attempt ${attemptNumber} remained in aiming or instructional feedback without a meaningful shot resolution.`;
    case "turn-resolution-loop":
      return `Attempt ${attemptNumber} remained in a non-productive turn-resolution loop without reaching a terminal state.`;
    case "non-actionable-battle-state":
      return `Attempt ${attemptNumber} reached a non-actionable battle state without terminal confirmation.`;
    case "dead-shot-sequence":
      return `Attempt ${attemptNumber} aborted after repeated non-productive shot feedback.`;
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
    observationCaptureMs: 0,
    snapshotTranslationMs: 0,
    actionExecutionMs: 0,
    artifactCaptureMs: 0,
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
    visionAvailableObserved: false,
    visionChangeSignals: 0,
    visionStrongChangeSignals: 0,
    visionTargetSideSignals: 0,
    visionTerrainSideSignals: 0,
    visionNoChangeShots: 0,
    visionNearTargetShots: 0,
    visionBlockedShots: 0,
    visionShortShots: 0,
    visionLongShots: 0,
    visionSelfSideShots: 0,
    lastVisionChangeStrength: "unknown",
    lastVisionImpactCategory: "unknown",
    lastVisionShotOutcomeLabel: "unknown",
    lastVisionShotOutcomeConfidence: "unknown",
    lastVisionShotOutcomeSource: "unavailable",
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
    cpuHpEnd: null,
    runtimeStateAvailable: false,
    runtimeStateSource: "unavailable",
    windValue: null,
    windNormalized: null,
    windDirection: "unknown",
    projectileLabel: null,
    projectileWeight: null,
    projectileLaunchSpeedMultiplier: null,
    projectileGravityMultiplier: null,
    projectileWindInfluenceMultiplier: null,
    projectileSplashRadius: null,
    projectileDamageMin: null,
    projectileDamageMax: null,
    projectileWindupSeconds: null,
    preparedShotAngle: null,
    preparedShotPower: null,
    preparedShotKey: null,
    plannedShots: 0,
    uniqueShotFingerprints: 0,
    repeatedShotPlans: 0,
    shotFamilySwitches: 0,
    meaningfulShotFeedbacks: 0,
    nonProductiveShots: 0,
    strongestFailedFamily: null,
    strongestFailedShotSequence: null,
    meaningfulAdaptationObserved: false,
    familyExhaustions: 0,
    deadPathAbortReason: null,
    strongestDeadPathSequence: null,
    unknownTerminationKind: "none"
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
  const windValue = readSemanticNumber(snapshot, "windValue");
  const windNormalized = readSemanticNumber(snapshot, "windNormalized");
  const projectileWeight = readSemanticNumber(snapshot, "projectileWeight");
  const projectileLaunchSpeedMultiplier = readSemanticNumber(snapshot, "projectileLaunchSpeedMultiplier");
  const projectileGravityMultiplier = readSemanticNumber(snapshot, "projectileGravityMultiplier");
  const projectileWindInfluenceMultiplier = readSemanticNumber(snapshot, "projectileWindInfluenceMultiplier");
  const projectileSplashRadius = readSemanticNumber(snapshot, "projectileSplashRadius");
  const projectileDamageMin = readSemanticNumber(snapshot, "projectileDamageMin");
  const projectileDamageMax = readSemanticNumber(snapshot, "projectileDamageMax");
  const projectileWindupSeconds = readSemanticNumber(snapshot, "projectileWindupSeconds");
  const preparedShotAngle = readSemanticNumber(snapshot, "preparedShotAngle");
  const preparedShotPower = readSemanticNumber(snapshot, "preparedShotPower");
  const runtimeStateAvailable = snapshot.semanticState.runtimeStateAvailable === true;
  const runtimeStateSource =
    snapshot.semanticState.runtimeStateSource === "fixture-hook" ||
    snapshot.semanticState.runtimeStateSource === "game-instance" ||
    snapshot.semanticState.runtimeStateSource === "error"
      ? snapshot.semanticState.runtimeStateSource
      : "unavailable";
  const windDirection =
    snapshot.semanticState.windDirection === "left" ||
    snapshot.semanticState.windDirection === "right" ||
    snapshot.semanticState.windDirection === "calm"
      ? snapshot.semanticState.windDirection
      : "unknown";
  const projectileLabel =
    typeof snapshot.semanticState.projectileLabel === "string" ? snapshot.semanticState.projectileLabel : null;
  const preparedShotKey =
    typeof snapshot.semanticState.preparedShotKey === "string" ? snapshot.semanticState.preparedShotKey : null;
  const semanticProgressSignalSource = snapshot.semanticState.progressSignalSource;
  const visionChangeStrength =
    snapshot.semanticState.visionChangeStrength === "none" ||
    snapshot.semanticState.visionChangeStrength === "subtle" ||
    snapshot.semanticState.visionChangeStrength === "strong"
      ? snapshot.semanticState.visionChangeStrength
      : "unknown";
  const visionImpactCategory =
    snapshot.semanticState.visionImpactCategory === "none" ||
    snapshot.semanticState.visionImpactCategory === "target-side-activity" ||
    snapshot.semanticState.visionImpactCategory === "terrain-or-midfield-activity" ||
    snapshot.semanticState.visionImpactCategory === "self-side-activity"
      ? snapshot.semanticState.visionImpactCategory
      : "unknown";
  const visionShotOutcomeLabel =
    snapshot.semanticState.visionShotOutcomeLabel === "none" ||
    snapshot.semanticState.visionShotOutcomeLabel === "no-meaningful-visual-change" ||
    snapshot.semanticState.visionShotOutcomeLabel === "self-side-impact" ||
    snapshot.semanticState.visionShotOutcomeLabel === "short" ||
    snapshot.semanticState.visionShotOutcomeLabel === "blocked" ||
    snapshot.semanticState.visionShotOutcomeLabel === "near-target" ||
    snapshot.semanticState.visionShotOutcomeLabel === "target-side-impact" ||
    snapshot.semanticState.visionShotOutcomeLabel === "long"
      ? snapshot.semanticState.visionShotOutcomeLabel
      : "unknown";
  const visionShotOutcomeConfidence =
    snapshot.semanticState.visionShotOutcomeConfidence === "low" ||
    snapshot.semanticState.visionShotOutcomeConfidence === "medium"
      ? snapshot.semanticState.visionShotOutcomeConfidence
      : "unknown";
  const visionShotOutcomeSource =
    snapshot.semanticState.visionShotOutcomeSource === "diff-only" ||
    snapshot.semanticState.visionShotOutcomeSource === "anchor-assisted"
      ? snapshot.semanticState.visionShotOutcomeSource
      : "unavailable";

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
    visionAvailableObserved:
      nextDiagnostics.visionAvailableObserved || snapshot.semanticState.visionAvailable === true,
    hpTrackingAvailable,
    damageTrackingConfirmed,
    progressSignalSource,
    runtimeStateAvailable: nextDiagnostics.runtimeStateAvailable || runtimeStateAvailable,
    runtimeStateSource: runtimeStateAvailable ? runtimeStateSource : nextDiagnostics.runtimeStateSource,
    windValue: windValue ?? nextDiagnostics.windValue,
    windNormalized: windNormalized ?? nextDiagnostics.windNormalized,
    windDirection: runtimeStateAvailable ? windDirection : nextDiagnostics.windDirection,
    projectileLabel: projectileLabel ?? nextDiagnostics.projectileLabel,
    projectileWeight: projectileWeight ?? nextDiagnostics.projectileWeight,
    projectileLaunchSpeedMultiplier:
      projectileLaunchSpeedMultiplier ?? nextDiagnostics.projectileLaunchSpeedMultiplier,
    projectileGravityMultiplier:
      projectileGravityMultiplier ?? nextDiagnostics.projectileGravityMultiplier,
    projectileWindInfluenceMultiplier:
      projectileWindInfluenceMultiplier ?? nextDiagnostics.projectileWindInfluenceMultiplier,
    projectileSplashRadius: projectileSplashRadius ?? nextDiagnostics.projectileSplashRadius,
    projectileDamageMin: projectileDamageMin ?? nextDiagnostics.projectileDamageMin,
    projectileDamageMax: projectileDamageMax ?? nextDiagnostics.projectileDamageMax,
    projectileWindupSeconds: projectileWindupSeconds ?? nextDiagnostics.projectileWindupSeconds,
    preparedShotAngle: preparedShotAngle ?? nextDiagnostics.preparedShotAngle,
    preparedShotPower: preparedShotPower ?? nextDiagnostics.preparedShotPower,
    preparedShotKey: preparedShotKey ?? nextDiagnostics.preparedShotKey
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

  if (snapshot.semanticState.visionAvailable === true) {
    nextDiagnostics = {
      ...nextDiagnostics,
      lastVisionChangeStrength: visionChangeStrength,
      lastVisionImpactCategory: visionImpactCategory,
      lastVisionShotOutcomeLabel: visionShotOutcomeLabel,
      lastVisionShotOutcomeConfidence: visionShotOutcomeConfidence,
      lastVisionShotOutcomeSource: visionShotOutcomeSource,
      ...(visionChangeStrength === "subtle" || visionChangeStrength === "strong"
        ? {
            visionChangeSignals: nextDiagnostics.visionChangeSignals + 1
          }
        : {}),
      ...(visionChangeStrength === "strong"
        ? {
            visionStrongChangeSignals: nextDiagnostics.visionStrongChangeSignals + 1
          }
        : {}),
      ...(visionImpactCategory === "target-side-activity"
        ? {
            visionTargetSideSignals: nextDiagnostics.visionTargetSideSignals + 1
          }
        : {}),
      ...(visionImpactCategory === "terrain-or-midfield-activity" || visionImpactCategory === "self-side-activity"
        ? {
            visionTerrainSideSignals: nextDiagnostics.visionTerrainSideSignals + 1
          }
        : {})
    };
  }

  if (snapshot.semanticState.visionAvailable === true) {
    nextDiagnostics = {
      ...nextDiagnostics,
      ...(visionShotOutcomeLabel === "near-target"
        ? {
            visionNearTargetShots: nextDiagnostics.visionNearTargetShots + 1
          }
        : {}),
      ...(visionShotOutcomeLabel === "blocked"
        ? {
            visionBlockedShots: nextDiagnostics.visionBlockedShots + 1
          }
        : {}),
      ...(visionShotOutcomeLabel === "short"
        ? {
            visionShortShots: nextDiagnostics.visionShortShots + 1
          }
        : {}),
      ...(visionShotOutcomeLabel === "long"
        ? {
            visionLongShots: nextDiagnostics.visionLongShots + 1
          }
        : {}),
      ...(visionShotOutcomeLabel === "self-side-impact"
        ? {
            visionSelfSideShots: nextDiagnostics.visionSelfSideShots + 1
          }
        : {})
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
  const strongestFailedAttempt =
    [...input.attempts]
      .filter((attempt) => attempt.outcome !== "WIN" && attempt.diagnostics.strongestFailedFamily)
      .sort((left, right) => scoreAttemptRecord(right) - scoreAttemptRecord(left) || right.attemptNumber - left.attemptNumber)[0] ??
    null;

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
      deadPathProtectedUnknowns: input.attempts.filter(
        (attempt) => attempt.outcome === "UNKNOWN" && attempt.diagnostics.unknownTerminationKind === "dead-path-protection"
      ).length,
      stepBudgetUnknowns: input.attempts.filter(
        (attempt) => attempt.outcome === "UNKNOWN" && attempt.diagnostics.unknownTerminationKind === "step-budget-exhausted"
      ).length,
      terminalAttempts: input.attempts.filter((attempt) => attempt.outcome !== "UNKNOWN").length,
      ...(winningAttempt ? { winningAttemptNumber: winningAttempt.attemptNumber } : {}),
      ...(winningAttempt ? { winningAttemptStrategy: toJsonValue(winningAttempt.strategy) } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptNumber: mostProgressiveAttempt.attemptNumber } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptStrategy: toJsonValue(mostProgressiveAttempt.strategy) } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptAssessment: mostProgressiveAttempt.assessment } : {}),
      ...(mostProgressiveAttempt ? { mostProgressiveAttemptScore: scoreAttemptRecord(mostProgressiveAttempt) } : {}),
      ...(strongestFailedAttempt
        ? {
            strongestFailedFamily: strongestFailedAttempt.diagnostics.strongestFailedFamily,
            strongestFailedShotSequence: strongestFailedAttempt.diagnostics.strongestFailedShotSequence,
            strongestDeadPathSequence: strongestFailedAttempt.diagnostics.strongestDeadPathSequence
          }
        : {}),
      reportId: input.report.reportId,
      artifactCount: input.artifacts.length
    },
    strategyInsights: {
      rankedAttemptVariants,
      strongestFailedFamily: strongestFailedAttempt?.diagnostics.strongestFailedFamily ?? null,
      strongestFailedShotSequence: strongestFailedAttempt?.diagnostics.strongestFailedShotSequence ?? null,
      strongestDeadPathSequence: strongestFailedAttempt?.diagnostics.strongestDeadPathSequence ?? null,
      lossesWithMeaningfulAdaptation: input.attempts.filter(
        (attempt) => attempt.outcome !== "WIN" && attempt.diagnostics.meaningfulAdaptationObserved
      ).length
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
      shotHistory: toJsonValue(attempt.shotHistory),
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

function buildObservationRequest(input: {
  decisionActionId?: string;
  snapshot?: GameSnapshot;
  includeVision?: boolean;
  includeRuntimeProbe?: boolean;
}): ObservationRequest {
  return buildCatAndDogObservationRequest(input);
}

interface PendingShotPlan {
  plan: CatAndDogShotExecutionPlan;
  plannedAt: string;
  prePlayerHp: number | null;
  preCpuHp: number | null;
  preTurnCounter: number | null;
}

function isWeaponKey(value: unknown): value is CatAndDogAttemptStrategy["weaponKey"] {
  return value === "normal" || value === "light" || value === "heavy" || value === "super" || value === "heal";
}

function buildShotPlanFromSnapshot(input: {
  strategy: CatAndDogAttemptStrategy;
  selectionDetails: CatAndDogStrategySelectionDetails;
  snapshot: GameSnapshot;
  shotHistory: readonly CatAndDogShotFeedbackRecord[];
}): CatAndDogShotExecutionPlan {
  return planCatAndDogShotExecution({
    attemptStrategy: input.strategy,
    selectionDetails: input.selectionDetails,
    runtime: {
      windDirection:
        input.snapshot.semanticState.windDirection === "left" ||
        input.snapshot.semanticState.windDirection === "right" ||
        input.snapshot.semanticState.windDirection === "calm"
          ? input.snapshot.semanticState.windDirection
          : "unknown",
      windNormalized: readSemanticNumber(input.snapshot, "windNormalized"),
      projectileLabel:
        typeof input.snapshot.semanticState.projectileLabel === "string"
          ? input.snapshot.semanticState.projectileLabel
          : null,
      projectileWeight: readSemanticNumber(input.snapshot, "projectileWeight"),
      projectileLaunchSpeedMultiplier: readSemanticNumber(input.snapshot, "projectileLaunchSpeedMultiplier"),
      projectileGravityMultiplier: readSemanticNumber(input.snapshot, "projectileGravityMultiplier"),
      projectileWindInfluenceMultiplier: readSemanticNumber(
        input.snapshot,
        "projectileWindInfluenceMultiplier"
      ),
      projectileSplashRadius: readSemanticNumber(input.snapshot, "projectileSplashRadius"),
      projectileDamageMin: readSemanticNumber(input.snapshot, "projectileDamageMin"),
      projectileDamageMax: readSemanticNumber(input.snapshot, "projectileDamageMax"),
      projectileWindupSeconds: readSemanticNumber(input.snapshot, "projectileWindupSeconds"),
      preparedShotAngle: readSemanticNumber(input.snapshot, "preparedShotAngle"),
      preparedShotPower: readSemanticNumber(input.snapshot, "preparedShotPower"),
      preparedShotKey:
        typeof input.snapshot.semanticState.preparedShotKey === "string"
          ? input.snapshot.semanticState.preparedShotKey
          : null,
      selectedWeaponKey:
        typeof input.snapshot.semanticState.selectedWeaponKey === "string"
          ? input.snapshot.semanticState.selectedWeaponKey
          : null
    },
    shotHistory: input.shotHistory
  });
}

function shouldFinalizePendingShot(snapshot: GameSnapshot, pendingShot: PendingShotPlan): boolean {
  const turnCounter = readSemanticNumber(snapshot, "turnCounter");
  const meaningfulVisualOutcome =
    snapshot.semanticState.visionShotOutcomeLabel === "short" ||
    snapshot.semanticState.visionShotOutcomeLabel === "long" ||
    snapshot.semanticState.visionShotOutcomeLabel === "blocked" ||
    snapshot.semanticState.visionShotOutcomeLabel === "near-target" ||
    snapshot.semanticState.visionShotOutcomeLabel === "target-side-impact" ||
    snapshot.semanticState.visionShotOutcomeLabel === "self-side-impact";
  const turnAdvanced =
    snapshot.semanticState.playerTurnReady === true &&
    pendingShot.preTurnCounter !== null &&
    turnCounter !== null &&
    turnCounter > pendingShot.preTurnCounter;
  return (
    snapshot.semanticState.shotResolved === true ||
    turnAdvanced ||
    meaningfulVisualOutcome ||
    snapshot.semanticState.endVisible === true ||
    snapshot.semanticState.outcome === "win" ||
    snapshot.semanticState.outcome === "loss"
  );
}

function buildShotFeedbackRecord(input: {
  pendingShot: PendingShotPlan;
  snapshot: GameSnapshot;
  resolvedAt: string;
}): CatAndDogShotRecord {
  const playerHp = readSemanticNumber(input.snapshot, "playerHpValue");
  const cpuHp = readSemanticNumber(input.snapshot, "cpuHpValue");
  const damageTakenDelta =
    input.pendingShot.prePlayerHp !== null && playerHp !== null
      ? Math.max(0, input.pendingShot.prePlayerHp - playerHp)
      : null;
  const damageDealtDelta =
    input.pendingShot.preCpuHp !== null && cpuHp !== null
      ? Math.max(0, input.pendingShot.preCpuHp - cpuHp)
      : null;
  const visualOutcomeLabel =
    input.snapshot.semanticState.visionShotOutcomeLabel === "none" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "no-meaningful-visual-change" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "self-side-impact" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "short" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "blocked" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "near-target" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "target-side-impact" ||
    input.snapshot.semanticState.visionShotOutcomeLabel === "long"
      ? input.snapshot.semanticState.visionShotOutcomeLabel
      : "unknown";
  const shotResolutionCategory =
    typeof input.snapshot.semanticState.shotResolutionCategory === "string"
      ? input.snapshot.semanticState.shotResolutionCategory
      : null;
  const hintCategory =
    typeof input.snapshot.semanticState.canvasHintCategory === "string"
      ? input.snapshot.semanticState.canvasHintCategory
      : null;
  const hintText =
    typeof input.snapshot.semanticState.canvasHintText === "string"
      ? input.snapshot.semanticState.canvasHintText
      : null;
  const meaningfulProgress =
    visualOutcomeLabel === "near-target" ||
    visualOutcomeLabel === "target-side-impact" ||
    shotResolutionCategory === "direct-hit" ||
    shotResolutionCategory === "splash-hit" ||
    (damageDealtDelta ?? 0) > 0;
  const familyFailed =
    input.snapshot.semanticState.outcome !== "win" &&
    (
      visualOutcomeLabel === "self-side-impact" ||
      visualOutcomeLabel === "blocked" ||
      visualOutcomeLabel === "short" ||
      visualOutcomeLabel === "no-meaningful-visual-change" ||
      shotResolutionCategory === "wall-hit" ||
      shotResolutionCategory === "miss" ||
      meaningfulProgress !== true
    );

  return {
    shotNumber: input.pendingShot.plan.shotNumber,
    plannedAt: input.pendingShot.plannedAt,
    resolvedAt: input.resolvedAt,
    family: input.pendingShot.plan.family,
    category: input.pendingShot.plan.category,
    source: input.pendingShot.plan.source,
    fingerprint: input.pendingShot.plan.fingerprint,
    familySwitchReason: input.pendingShot.plan.familySwitchReason,
    projectilePolicyReason: input.pendingShot.plan.projectilePolicyReason,
    adaptationReason: input.pendingShot.plan.adaptationReason,
    inputsUsed: input.pendingShot.plan.inputsUsed,
    strategy: toJsonValue(input.pendingShot.plan.strategy) as JsonObject,
    feedback: {
      visualOutcomeLabel,
      shotResolutionCategory,
      hintCategory,
      hintText,
      damageDealtDelta,
      damageTakenDelta,
      shotResolved: input.snapshot.semanticState.shotResolved === true,
      playerTurnReadyAfter: input.snapshot.semanticState.playerTurnReady === true,
      turnCounterAfter: toJsonValue(input.snapshot.semanticState.turnCounter),
      outcomeAfterShot:
        input.snapshot.semanticState.outcome === "win" ||
        input.snapshot.semanticState.outcome === "loss"
          ? input.snapshot.semanticState.outcome
          : null,
      meaningfulProgress,
      familyFailed
    }
  };
}

function toShotPlannerFeedback(record: CatAndDogShotRecord): CatAndDogShotFeedbackRecord {
  return {
    shotNumber: record.shotNumber,
    family: record.family as CatAndDogShotFeedbackRecord["family"],
    category: record.category as CatAndDogShotFeedbackRecord["category"],
    fingerprint: record.fingerprint,
    weaponKey: isWeaponKey(record.strategy.weaponKey) ? record.strategy.weaponKey : "normal",
    angleDirection: record.strategy.angleDirection === "left" ? "left" : "right",
    angleTapCount: typeof record.strategy.angleTapCount === "number" ? record.strategy.angleTapCount : 0,
    powerDirection: record.strategy.powerDirection === "down" ? "down" : "up",
    powerTapCount: typeof record.strategy.powerTapCount === "number" ? record.strategy.powerTapCount : 0,
    visualOutcomeLabel:
      record.feedback.visualOutcomeLabel === "none" ||
      record.feedback.visualOutcomeLabel === "no-meaningful-visual-change" ||
      record.feedback.visualOutcomeLabel === "self-side-impact" ||
      record.feedback.visualOutcomeLabel === "short" ||
      record.feedback.visualOutcomeLabel === "blocked" ||
      record.feedback.visualOutcomeLabel === "near-target" ||
      record.feedback.visualOutcomeLabel === "target-side-impact" ||
      record.feedback.visualOutcomeLabel === "long"
        ? record.feedback.visualOutcomeLabel
        : "unknown",
    shotResolutionCategory:
      typeof record.feedback.shotResolutionCategory === "string" ? record.feedback.shotResolutionCategory : null,
    hintCategory: typeof record.feedback.hintCategory === "string" ? record.feedback.hintCategory : null,
    hintText: typeof record.feedback.hintText === "string" ? record.feedback.hintText : null,
    damageDealtDelta:
      typeof record.feedback.damageDealtDelta === "number" ? record.feedback.damageDealtDelta : null,
    damageTakenDelta:
      typeof record.feedback.damageTakenDelta === "number" ? record.feedback.damageTakenDelta : null,
    shotResolved: record.feedback.shotResolved === true,
    playerTurnReadyAfter: record.feedback.playerTurnReadyAfter === true,
    turnCounterAfter:
      typeof record.feedback.turnCounterAfter === "number" ? record.feedback.turnCounterAfter : null,
    outcomeAfterShot:
      record.feedback.outcomeAfterShot === "WIN" ||
      record.feedback.outcomeAfterShot === "LOSS" ||
      record.feedback.outcomeAfterShot === "UNKNOWN"
        ? record.feedback.outcomeAfterShot
        : record.feedback.outcomeAfterShot === "win"
          ? "WIN"
          : record.feedback.outcomeAfterShot === "loss"
            ? "LOSS"
            : null,
    meaningfulProgress: record.feedback.meaningfulProgress === true,
    familyFailed: record.feedback.familyFailed === true
  };
}

function buildShotHistoryDiagnostics(
  shotHistory: readonly CatAndDogShotRecord[]
): Pick<
  CatAndDogAttemptRunDiagnostics,
  | "plannedShots"
  | "uniqueShotFingerprints"
  | "repeatedShotPlans"
  | "shotFamilySwitches"
  | "meaningfulShotFeedbacks"
  | "nonProductiveShots"
  | "strongestFailedFamily"
  | "strongestFailedShotSequence"
  | "meaningfulAdaptationObserved"
  | "familyExhaustions"
  | "strongestDeadPathSequence"
> {
  const uniqueFingerprints = new Set(shotHistory.map((shot) => shot.fingerprint));
  const failedShots = shotHistory.filter((shot) => shot.feedback.familyFailed === true);
  const familyCounts = new Map<string, number>();
  for (const shot of failedShots) {
    familyCounts.set(shot.family, (familyCounts.get(shot.family) ?? 0) + 1);
  }
  const strongestFailedFamily =
    [...familyCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const strongestFailedShotSequence =
    failedShots.length > 0
      ? failedShots
          .slice(-3)
          .map((shot) => `${shot.family}:${String(shot.feedback.visualOutcomeLabel ?? "unknown")}`)
          .join(" -> ")
      : null;
  const strongestDeadPathSequence =
    failedShots.length >= 2
      ? failedShots
          .slice(-4)
          .map(
            (shot) =>
              `${shot.family}:${String(shot.feedback.visualOutcomeLabel ?? "unknown")}:${String(
                shot.feedback.shotResolutionCategory ?? "none"
              )}`
          )
          .join(" -> ")
      : null;
  const familyExhaustions = [...familyCounts.values()].filter((count) => count >= 2).length;

  return {
    plannedShots: shotHistory.length,
    uniqueShotFingerprints: uniqueFingerprints.size,
    repeatedShotPlans: Math.max(0, shotHistory.length - uniqueFingerprints.size),
    shotFamilySwitches: shotHistory.filter((shot) => typeof shot.familySwitchReason === "string").length,
    meaningfulShotFeedbacks: shotHistory.filter((shot) => shot.feedback.meaningfulProgress === true).length,
    nonProductiveShots: shotHistory.filter((shot) => shot.feedback.familyFailed === true).length,
    strongestFailedFamily,
    strongestFailedShotSequence,
    familyExhaustions,
    strongestDeadPathSequence,
    meaningfulAdaptationObserved:
      uniqueFingerprints.size > 1 ||
      shotHistory.some((shot) => typeof shot.familySwitchReason === "string" || typeof shot.adaptationReason === "string")
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
  let recentEvents: readonly RunEvent[] = [];

  const appendTrackedEvent = async (event: RunEvent): Promise<void> => {
    await container.runEngine.appendEvent(event);
    recentEvents = [...recentEvents, event];
  };

  const storeArtifactEvent = async (artifact: ArtifactRef): Promise<void> => {
    capturedArtifacts.push(artifact);
    await appendTrackedEvent({
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
    recentEvents = await container.runEngine.listEvents(run.runId);

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

      await appendTrackedEvent({
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
      let maxStepsBudget = maxStepsPerAttempt;

      const openingObserveStartedAt = Date.now();
      const openingFrame = await environmentSession.observe(
        buildObservationRequest({
          includeVision: false,
          includeRuntimeProbe: false
        })
      );
      let diagnostics = createAttemptDiagnostics(maxStepsBudget);
      diagnostics = {
        ...diagnostics,
        observationCaptureMs: diagnostics.observationCaptureMs + (Date.now() - openingObserveStartedAt)
      };
      const openingTranslateStartedAt = Date.now();
      let currentSnapshot = await gameSession.translate(openingFrame);
      diagnostics = {
        ...diagnostics,
        snapshotTranslationMs: diagnostics.snapshotTranslationMs + (Date.now() - openingTranslateStartedAt)
      };
      const captureAttemptArtifactWithTiming = async (
        step: number,
        label: string,
        kind: "screenshot" | "dom-snapshot"
      ): Promise<ArtifactRef> => {
        const startedAt = Date.now();
        const artifact = await captureAttemptArtifact(attemptNumber, step, label, kind);
        diagnostics = {
          ...diagnostics,
          artifactCaptureMs: diagnostics.artifactCaptureMs + (Date.now() - startedAt)
        };
        return artifact;
      };
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
      await appendTrackedEvent(openingObservationEvent);

      attemptArtifacts.push(
        await captureAttemptArtifactWithTiming(10, "pre-gameplay-screen", "screenshot")
      );

      const actionHistory: JsonObject[] = [];
      const shotHistory: CatAndDogShotRecord[] = [];
      let pendingShot: PendingShotPlan | null = null;
      let postEntryCaptured = false;
      let endStateCaptured = false;
      let outcome: AttemptOutcome = "UNKNOWN";
      let note = `Attempt ${attemptNumber} reached the step budget without a terminal outcome.`;
      let lastKnownGoodRuntimeState = extractRuntimeState(currentSnapshot);
      let lastKnownGoodVisionState = extractVisionState(currentSnapshot);
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
          recentEvents
        });

        if (decision.type === "complete") {
          note = decision.reason;
          break;
        }

        if (decision.type !== "game-action") {
          throw new Error(`Expected a semantic game action, received ${decision.type}.`);
        }

        let semanticActionId = decision.actionId;
        let semanticActionParams = decision.params;
        if (semanticActionId === "execute-planned-shot") {
          if (pendingShot) {
            if (shouldFinalizePendingShot(currentSnapshot, pendingShot)) {
              shotHistory.push(
                buildShotFeedbackRecord({
                  pendingShot,
                  snapshot: currentSnapshot,
                  resolvedAt: clock.now().toISOString()
                })
              );
            }
            pendingShot = null;
          }

          const plannedShot = buildShotPlanFromSnapshot({
            strategy,
            selectionDetails: strategySelectionDetails,
            snapshot: currentSnapshot,
            shotHistory: shotHistory.map((entry) => toShotPlannerFeedback(entry))
          });
          semanticActionParams = {
            weaponKey: plannedShot.strategy.weaponKey,
            angleDirection: plannedShot.strategy.angleDirection,
            angleTapCount: plannedShot.strategy.angleTapCount,
            powerDirection: plannedShot.strategy.powerDirection,
            powerTapCount: plannedShot.strategy.powerTapCount,
            settleMs: plannedShot.strategy.settleMs,
            turnResolutionWaitMs: plannedShot.strategy.turnResolutionWaitMs
          };
          pendingShot = {
            plan: plannedShot,
            plannedAt: clock.now().toISOString(),
            prePlayerHp: readSemanticNumber(currentSnapshot, "playerHpValue"),
            preCpuHp: readSemanticNumber(currentSnapshot, "cpuHpValue"),
            preTurnCounter: readSemanticNumber(currentSnapshot, "turnCounter")
          };
        }

        diagnostics = {
          ...diagnostics,
          semanticActionCount: diagnostics.semanticActionCount + 1,
          ...(semanticActionId === "execute-planned-shot"
            ? { shotsFired: diagnostics.shotsFired + 1 }
            : {}),
          ...(semanticActionId === "wait-for-turn-resolution"
            ? { waitActions: diagnostics.waitActions + 1 }
            : {})
        };

        actionHistory.push({
          step,
          actionId: semanticActionId,
          ...(semanticActionParams ? { params: toJsonValue(semanticActionParams) } : {}),
          ...(semanticActionId === "execute-planned-shot" && pendingShot
            ? {
                shotPlan: toJsonValue({
                  family: pendingShot.plan.family,
                  category: pendingShot.plan.category,
                  source: pendingShot.plan.source,
                  fingerprint: pendingShot.plan.fingerprint,
                  familySwitchReason: pendingShot.plan.familySwitchReason,
                  projectilePolicyReason: pendingShot.plan.projectilePolicyReason,
                  adaptationReason: pendingShot.plan.adaptationReason,
                  inputsUsed: pendingShot.plan.inputsUsed
                })
              }
            : {})
        });

        const environmentActions = await gameSession.resolveAction(
          {
            actionId: semanticActionId,
            params: semanticActionParams
          },
          currentSnapshot
        );

        for (const environmentAction of environmentActions) {
          if (environmentAction.kind === "wait") {
            diagnostics = {
              ...diagnostics,
              totalWaitMs: diagnostics.totalWaitMs + environmentAction.durationMs,
              ...(semanticActionId === "wait-for-turn-resolution"
                ? {
                    resolutionWaitMs: diagnostics.resolutionWaitMs + environmentAction.durationMs
                  }
                : {})
            };
          }

          const actionExecutionStartedAt = Date.now();
          const actionResult = await environmentSession.execute(environmentAction);
          diagnostics = {
            ...diagnostics,
            actionExecutionMs: diagnostics.actionExecutionMs + (Date.now() - actionExecutionStartedAt)
          };
          await appendTrackedEvent({
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
              semanticActionId,
              ...(semanticActionParams ? { semanticActionParams: toJsonValue(semanticActionParams) } : {}),
              ...actionResult.payload
            }
          });
        }

        const shouldIncludeVision =
          semanticActionId === "execute-planned-shot" || semanticActionId === "start-cpu-match";
        const shouldIncludeRuntimeProbe =
          semanticActionId === "execute-planned-shot" || semanticActionId === "start-cpu-match";
        const postActionObserveStartedAt = Date.now();
        const postActionFrame = await environmentSession.observe(
          buildObservationRequest({
            decisionActionId: semanticActionId,
            snapshot: currentSnapshot,
            includeVision: shouldIncludeVision,
            includeRuntimeProbe: shouldIncludeRuntimeProbe
          })
        );
        diagnostics = {
          ...diagnostics,
          observationCaptureMs: diagnostics.observationCaptureMs + (Date.now() - postActionObserveStartedAt)
        };
        const postActionTranslateStartedAt = Date.now();
        currentSnapshot = await gameSession.translate(postActionFrame);
        diagnostics = {
          ...diagnostics,
          snapshotTranslationMs: diagnostics.snapshotTranslationMs + (Date.now() - postActionTranslateStartedAt)
        };
        lastKnownGoodRuntimeState = extractRuntimeState(currentSnapshot) ?? lastKnownGoodRuntimeState;
        lastKnownGoodVisionState = extractVisionState(currentSnapshot) ?? lastKnownGoodVisionState;
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
        if (
          semanticActionId === "execute-planned-shot" &&
          currentSnapshot.semanticState.visionAvailable === true &&
          currentSnapshot.semanticState.visionChangeStrength === "none"
        ) {
          diagnostics = {
            ...diagnostics,
            visionNoChangeShots: diagnostics.visionNoChangeShots + 1
          };
        }
        if (pendingShot && shouldFinalizePendingShot(currentSnapshot, pendingShot)) {
          shotHistory.push(
            buildShotFeedbackRecord({
              pendingShot,
              snapshot: currentSnapshot,
              resolvedAt: clock.now().toISOString()
            })
          );
          pendingShot = null;
        }
        await appendTrackedEvent({
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
            await captureAttemptArtifactWithTiming(20, "post-entry-screen", "screenshot")
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
            await captureAttemptArtifactWithTiming(30, "end-state-screen", "screenshot")
          );
          if (postActionOutcome === "WIN" || postActionOutcome === "LOSS") {
            attemptArtifacts.push(
              await captureAttemptArtifactWithTiming(40, "outcome-screen", "screenshot")
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
          unchangedObservationCycles,
          shotHistory
        });
        if (stallReason) {
          diagnostics = {
            ...diagnostics,
            stalledLoopDetected: true,
            stalledLoopReason: stallReason,
            deadPathAbortReason: stallReason
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
          await captureAttemptArtifactWithTiming(20, "post-entry-screen", "screenshot")
        );
      }

      if (!endStateCaptured) {
        attemptArtifacts.push(
          await captureAttemptArtifactWithTiming(30, "end-state-screen", "screenshot")
        );
        if (outcome === "WIN" || outcome === "LOSS") {
          attemptArtifacts.push(
            await captureAttemptArtifactWithTiming(40, "outcome-screen", "screenshot")
          );
        }
      }

      attemptArtifacts.push(
        await captureAttemptArtifactWithTiming(50, "final-state-dom", "dom-snapshot")
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
      if (pendingShot) {
        if (shouldFinalizePendingShot(currentSnapshot, pendingShot)) {
          shotHistory.push(
            buildShotFeedbackRecord({
              pendingShot,
              snapshot: currentSnapshot,
              resolvedAt: attemptEndedAt
            })
          );
        }
        pendingShot = null;
      }
      const elapsedMs = Math.max(
        0,
        Number.isFinite(attemptStartedAtMs) ? Date.parse(attemptEndedAt) - attemptStartedAtMs : 0
      );
      const assessment = buildAttemptAssessment(outcome, diagnostics);
      const shotHistoryDiagnostics = buildShotHistoryDiagnostics(shotHistory);
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
          ...shotHistoryDiagnostics,
          elapsedMs,
          nonWaitOverheadMs: Math.max(0, elapsedMs - diagnostics.totalWaitMs),
          waitHeavyRatio:
            elapsedMs > 0
              ? Number((diagnostics.totalWaitMs / elapsedMs).toFixed(3))
              : 0,
          unknownTerminationKind:
            outcome !== "UNKNOWN"
              ? "none"
              : diagnostics.deadPathAbortReason || diagnostics.stalledLoopDetected
                ? "dead-path-protection"
                : diagnostics.stepBudgetReached
                  ? "step-budget-exhausted"
                  : "ambiguous-final-state"
        },
        actionHistory,
        shotHistory,
        finalState: summarizeFinalStateWithContext({
          snapshot: currentSnapshot,
          lastKnownGoodRuntimeState,
          lastKnownGoodVisionState
        }),
        artifacts: [...attemptArtifacts].sort(byArtifactPath)
      };
      attempts.push(attemptRecord);

      await appendTrackedEvent({
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
          shotHistory: toJsonValue(shotHistory),
          finalState: summarizeFinalStateWithContext({
            snapshot: currentSnapshot,
            lastKnownGoodRuntimeState,
            lastKnownGoodVisionState
          }),
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
    await appendTrackedEvent({
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
