import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, JsonObject, JsonValue, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import {
  chooseMinesweeperMove,
  type MinesweeperMoveChoice,
  type MinesweeperPolicyBoard,
  type MinesweeperPolicyCell
} from "@game-bots/agent-player";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import type { GameSnapshot } from "@game-bots/game-sdk";
import {
  MINESWEEPER_ONLINE_BOARD_RUNTIME_PROBE,
  MINESWEEPER_ONLINE_PLAYER_BEGINNER_PROFILE_ID,
  minesweeperBoardHash
} from "@game-bots/minesweeper-online-web";
import { toJsonReport } from "@game-bots/reporting";
import { SystemClock } from "@game-bots/runtime-core";

import type { AppContainer } from "../bootstrap/container.js";
import { resolveGamePlugin } from "../bootstrap/game-plugins.js";

export interface MinesweeperOnlineRunOptions {
  readonly difficulty?: "beginner";
  readonly maxMoves?: number;
  readonly headless?: boolean;
}

type MinesweeperLoopState =
  | "bootstrapping"
  | "waiting-for-board"
  | "choosing-move"
  | "executing-move"
  | "observing-result"
  | "game-ended"
  | "max-moves-reached"
  | "no-move"
  | "failed";

export interface MinesweeperObservationRecord {
  readonly timestamp: string;
  readonly moveNumber: number;
  readonly loopState: MinesweeperLoopState;
  readonly status: string | null;
  readonly difficulty: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly mineCount: number | null;
  readonly remainingMines: number | null;
  readonly revealedCount: number | null;
  readonly flaggedCount: number | null;
  readonly hiddenCount: number | null;
  readonly boardHash: string | null;
  readonly boardChangedSinceLastObservation: boolean;
  readonly screenshotPath: string | null;
}

export interface MinesweeperMoveRecord {
  readonly moveNumber: number;
  readonly playedAt: string;
  readonly action: MinesweeperMoveChoice["action"];
  readonly executedAction: "reveal" | "flag";
  readonly x: number;
  readonly y: number;
  readonly reason: string;
  readonly sourceCells: readonly { readonly x: number; readonly y: number }[];
  readonly safeMoveCount: number;
  readonly knownMineCount: number;
  readonly hiddenCount: number;
  readonly flaggedCount: number;
  readonly riskEstimate: number | null;
  readonly firstClick: boolean;
  readonly beforeStatus: string | null;
  readonly afterStatus: string | null;
  readonly beforeBoardHash: string | null;
  readonly afterBoardHash: string | null;
  readonly moveApplied: boolean;
  readonly outcome: "WIN" | "LOSS" | null;
  readonly beforeScreenshotPath: string | null;
  readonly afterScreenshotPath: string | null;
}

export interface MinesweeperOnlineRunResult {
  readonly run: RunRecord;
  readonly events: readonly RunEvent[];
  readonly report: RunReport;
  readonly moves: readonly MinesweeperMoveRecord[];
  readonly artifacts: readonly ArtifactRef[];
}

const DEFAULT_MAX_MOVES = 200;

export async function runPlayerMinesweeperOnline(
  container: AppContainer,
  options: MinesweeperOnlineRunOptions = {}
): Promise<MinesweeperOnlineRunResult> {
  const difficulty = options.difficulty ?? "beginner";
  if (difficulty !== "beginner") {
    throw new Error("Minesweeper Online player only supports --difficulty=beginner in this milestone.");
  }
  const maxMoves = Math.max(1, Math.min(500, options.maxMoves ?? DEFAULT_MAX_MOVES));
  const headless = options.headless ?? true;
  const plugin = resolveGamePlugin("minesweeper-online-web");
  const environmentPort = new PlaywrightEnvironmentPort({
    artifactStore: container.artifactStore
  });
  const clock = new SystemClock();
  const request: RunRequest = {
    agentKind: "player",
    gameId: plugin.manifest.gameId,
    environmentId: environmentPort.environmentId,
    profileId: MINESWEEPER_ONLINE_PLAYER_BEGINNER_PROFILE_ID,
    config: {
      difficulty,
      maxMoves,
      headless,
      safety: "visible-dom-only"
    }
  };

  let run = await container.runEngine.createRun(request);
  const logger = container.logger.child({
    runId: run.runId,
    agentKind: request.agentKind,
    gameId: request.gameId,
    profileId: request.profileId
  });
  const session = await plugin.createSession({ profileId: MINESWEEPER_ONLINE_PLAYER_BEGINNER_PROFILE_ID });
  const environmentSession = await environmentPort.openSession();
  const capturedArtifacts: ArtifactRef[] = [];
  const moves: MinesweeperMoveRecord[] = [];
  const observations: MinesweeperObservationRecord[] = [];
  let report: RunReport | null = null;
  let recentEvents: readonly RunEvent[] = [];
  let finalLoopState: MinesweeperLoopState = "bootstrapping";
  let stopReason: string | null = null;
  let lastBoardHash: string | null = null;

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

  const captureArtifact = async (
    moveNumber: number,
    label: string,
    kind: "screenshot" | "dom-snapshot"
  ): Promise<ArtifactRef> => {
    const artifact = await environmentSession.capture({
      kind,
      name: `move-${String(moveNumber).padStart(3, "0")}-${label}`
    });
    await storeArtifactEvent(artifact);
    return artifact;
  };

  const observeAndRecord = async (
    moveNumber: number,
    loopState: MinesweeperLoopState,
    screenshotPath: string | null = null
  ): Promise<{ readonly snapshot: GameSnapshot; readonly board: MinesweeperPolicyBoard; readonly record: MinesweeperObservationRecord }> => {
    finalLoopState = loopState;
    const frame = await environmentSession.observe({
      modes: ["dom", "screenshot", "console"],
      runtimeProbe: MINESWEEPER_ONLINE_BOARD_RUNTIME_PROBE
    });
    const snapshot = await session.translate(frame);
    const board = boardFromSnapshot(snapshot);
    const boardHash = minesweeperBoardHash({
      boardDetected: snapshot.semanticState.boardDetected === true,
      width: readNumber(snapshot.semanticState, "width"),
      height: readNumber(snapshot.semanticState, "height"),
      difficulty: readString(snapshot.semanticState, "difficulty") === "beginner" ? "beginner" : "unknown",
      mineCount: readNumber(snapshot.semanticState, "mineCount"),
      remainingMines: readNumber(snapshot.semanticState, "remainingMines"),
      revealedCount: readNumber(snapshot.semanticState, "revealedCount") ?? 0,
      flaggedCount: readNumber(snapshot.semanticState, "flaggedCount") ?? 0,
      hiddenCount: readNumber(snapshot.semanticState, "hiddenCount") ?? 0,
      status: readStatus(snapshot.semanticState),
      faceClass: readString(snapshot.semanticState, "faceClass"),
      boardBounds: null,
      cellSize: readNumber(snapshot.semanticState, "cellSize"),
      cells: board.cells.map((cell) => ({
        ...cell,
        screen: null,
        className: ""
      }))
    });
    const record: MinesweeperObservationRecord = {
      timestamp: clock.now().toISOString(),
      moveNumber,
      loopState,
      status: readString(snapshot.semanticState, "status"),
      difficulty: readString(snapshot.semanticState, "difficulty"),
      width: readNumber(snapshot.semanticState, "width"),
      height: readNumber(snapshot.semanticState, "height"),
      mineCount: readNumber(snapshot.semanticState, "mineCount"),
      remainingMines: readNumber(snapshot.semanticState, "remainingMines"),
      revealedCount: readNumber(snapshot.semanticState, "revealedCount"),
      flaggedCount: readNumber(snapshot.semanticState, "flaggedCount"),
      hiddenCount: readNumber(snapshot.semanticState, "hiddenCount"),
      boardHash,
      boardChangedSinceLastObservation: Boolean(lastBoardHash && boardHash && boardHash !== lastBoardHash),
      screenshotPath
    };
    lastBoardHash = boardHash ?? lastBoardHash;
    observations.push(record);
    await appendTrackedEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: clock.now().toISOString(),
      type: "observation.captured",
      observationKind: "minesweeper.board.observed",
      summary: `Minesweeper Online ${loopState} observation for move ${moveNumber}.`,
      payload: {
        moveNumber,
        minesweeper: toJsonValue(record),
        gameSemanticState: toJsonValue(snapshot.semanticState)
      }
    });
    return { snapshot, board, record };
  };

  logger.info({ difficulty, maxMoves, headless }, "Starting minesweeper-online player run.");

  try {
    run = await container.runEngine.transitionPhase(run, "preparing");
    run = await container.runEngine.transitionPhase(run, "environment_starting");
    await environmentSession.start({
      runId: run.runId,
      headless,
      viewport: {
        width: 1200,
        height: 900
      }
    });

    run = await container.runEngine.transitionPhase(run, "game_bootstrap");
    await session.bootstrap(environmentSession);
    run = await container.runEngine.transitionPhase(run, "executing");

    for (let moveNumber = 1; moveNumber <= maxMoves; moveNumber += 1) {
      const beforeScreenshot = await captureArtifact(moveNumber, "before-move", "screenshot");
      const before = await observeAndRecord(moveNumber, moveNumber === 1 ? "waiting-for-board" : "choosing-move", beforeScreenshot.relativePath);
      const beforeStatus = readString(before.snapshot.semanticState, "status");
      if (beforeStatus === "win" || beforeStatus === "loss") {
        finalLoopState = "game-ended";
        stopReason = `game-ended:${beforeStatus}`;
        break;
      }
      const choice = chooseMinesweeperMove(before.board);
      if (!choice) {
        finalLoopState = "no-move";
        stopReason = "no-visible-move";
        break;
      }

      finalLoopState = "executing-move";
      const executedAction = choice.action === "flag" ? "flag" : "reveal";
      const actions = await session.resolveAction(
        {
          actionId: executedAction === "flag" ? "flag-cell" : "reveal-cell",
          params: {
            x: choice.x,
            y: choice.y
          }
        },
        before.snapshot
      );
      for (const action of actions) {
        await environmentSession.execute(action);
      }
      await appendTrackedEvent({
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: clock.now().toISOString(),
        type: "action.executed",
        actionKind: "mouse-click",
        status: "succeeded",
        summary: `Minesweeper ${choice.action} at ${choice.x},${choice.y}.`,
        payload: {
          semanticActionId: "execute-minesweeper-move",
          semanticActionParams: toJsonValue(choice),
          executedAction
        }
      });

      const afterScreenshot = await captureArtifact(moveNumber, "after-move", "screenshot");
      const after = await observeAndRecord(moveNumber, "observing-result", afterScreenshot.relativePath);
      const afterStatus = readString(after.snapshot.semanticState, "status");
      const moveRecord: MinesweeperMoveRecord = {
        moveNumber,
        playedAt: clock.now().toISOString(),
        action: choice.action,
        executedAction,
        x: choice.x,
        y: choice.y,
        reason: choice.reason,
        sourceCells: choice.sourceCells,
        safeMoveCount: choice.safeMoveCount,
        knownMineCount: choice.knownMineCount,
        hiddenCount: choice.hiddenCount,
        flaggedCount: choice.flaggedCount,
        riskEstimate: choice.riskEstimate,
        firstClick: choice.firstClick,
        beforeStatus,
        afterStatus,
        beforeBoardHash: before.record.boardHash,
        afterBoardHash: after.record.boardHash,
        moveApplied: Boolean(after.record.boardHash && after.record.boardHash !== before.record.boardHash),
        outcome: afterStatus === "win" ? "WIN" : afterStatus === "loss" ? "LOSS" : null,
        beforeScreenshotPath: beforeScreenshot.relativePath,
        afterScreenshotPath: afterScreenshot.relativePath
      };
      moves.push(moveRecord);

      logger.info({ moveNumber, choice, afterStatus, moveApplied: moveRecord.moveApplied }, "Played minesweeper-online move.");

      if (moveRecord.outcome) {
        finalLoopState = "game-ended";
        stopReason = `game-ended:${moveRecord.outcome}`;
        break;
      }
      if (moveNumber === maxMoves) {
        finalLoopState = "max-moves-reached";
        stopReason = "max-moves-reached";
      }
    }

    await captureArtifact(Math.max(1, moves.length), "final-state-dom", "dom-snapshot");
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

    const summaryArtifact = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "json",
        relativePath: "reports/02-minesweeper-online-player-summary.json",
        contentType: "application/json"
      },
      Buffer.from(
        JSON.stringify(
          buildMinesweeperSummaryJson({
            run,
            report,
            moves,
            observations,
            artifacts: capturedArtifacts,
            stopReason,
            finalLoopState,
            options: { difficulty, maxMoves, headless }
          }),
          null,
          2
        ),
        "utf8"
      )
    );
    await storeArtifactEvent(summaryArtifact);

    await appendTrackedEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: clock.now().toISOString(),
      type: "report.generated",
      reportId: report.reportId,
      evidence: capturedArtifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        label: artifact.relativePath
      }))
    });

    run = await container.runEngine.completeRun(run);
    logger.info({ moveCount: moves.length, artifactCount: capturedArtifacts.length }, "Completed minesweeper-online player run.");
    process.stdout.write(`Completed minesweeper-online player run ${run.runId} with ${moves.length} move(s) and ${capturedArtifacts.length} artifacts.\n`);
  } catch (error) {
    finalLoopState = "failed";
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Minesweeper Online player run failed.");
    run = await container.runEngine.failRun(run, "MINESWEEPER_ONLINE_PLAYER_RUN_FAILED", message);
    throw error;
  } finally {
    await environmentSession.stop("minesweeper-online-player-run-finished").catch(() => undefined);
  }

  if (!report) {
    throw new Error("Minesweeper Online player run did not produce a report.");
  }

  return {
    run,
    events: recentEvents,
    report,
    moves,
    artifacts: capturedArtifacts
  };
}

function buildMinesweeperSummaryJson(input: {
  readonly run: RunRecord;
  readonly report: RunReport;
  readonly moves: readonly MinesweeperMoveRecord[];
  readonly observations: readonly MinesweeperObservationRecord[];
  readonly artifacts: readonly ArtifactRef[];
  readonly stopReason: string | null;
  readonly finalLoopState: MinesweeperLoopState;
  readonly options: Required<MinesweeperOnlineRunOptions>;
}): JsonObject {
  const latestObservation = input.observations.at(-1);
  return {
    run: input.run as unknown as JsonObject,
    report: input.report as unknown as JsonObject,
    summary: {
      gameId: input.run.gameId,
      requestedDifficulty: input.options.difficulty,
      runtimeDifficulty: latestObservation?.difficulty ?? null,
      difficulty: input.options.difficulty,
      maxMoves: input.options.maxMoves,
      headless: input.options.headless,
      movesPlayed: input.moves.length,
      outcome: input.moves.at(-1)?.outcome ?? null,
      hadWin: input.moves.at(-1)?.outcome === "WIN",
      stopReason: input.stopReason,
      finalLoopState: input.finalLoopState,
      boardWidth: latestObservation?.width ?? null,
      boardHeight: latestObservation?.height ?? null,
      mineCount: latestObservation?.mineCount ?? null,
      revealedCount: latestObservation?.revealedCount ?? null,
      flaggedCount: latestObservation?.flaggedCount ?? null,
      hiddenCount: latestObservation?.hiddenCount ?? null,
      safety: "visible-dom-only"
    },
    moves: input.moves as unknown as JsonValue,
    observations: input.observations as unknown as JsonValue,
    artifacts: input.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      relativePath: artifact.relativePath,
      contentType: artifact.contentType,
      createdAt: artifact.createdAt
    }))
  };
}

function boardFromSnapshot(snapshot: GameSnapshot): MinesweeperPolicyBoard {
  const cells = Array.isArray(snapshot.semanticState.cells) ? snapshot.semanticState.cells : [];
  return {
    width: readNumber(snapshot.semanticState, "width") ?? 0,
    height: readNumber(snapshot.semanticState, "height") ?? 0,
    mineCount: readNumber(snapshot.semanticState, "mineCount"),
    cells: cells.map(asPolicyCell).filter((cell): cell is MinesweeperPolicyCell => cell !== null)
  };
}

function asPolicyCell(value: unknown): MinesweeperPolicyCell | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = typeof record.x === "number" ? record.x : null;
  const y = typeof record.y === "number" ? record.y : null;
  const state = typeof record.state === "string" ? record.state : null;
  if (x === null || y === null || !isPolicyCellState(state)) {
    return null;
  }
  return {
    x,
    y,
    state,
    adjacentMineCount: typeof record.adjacentMineCount === "number" ? record.adjacentMineCount : null
  };
}

function isPolicyCellState(value: string | null): value is MinesweeperPolicyCell["state"] {
  return value === "hidden" || value === "revealed" || value === "flagged" || value === "exploded" || value === "unknown";
}

function readStatus(record: JsonObject): "loading" | "in-progress" | "win" | "loss" | "unknown" {
  const status = readString(record, "status");
  if (status === "loading" || status === "in-progress" || status === "win" || status === "loss" || status === "unknown") {
    return status;
  }
  return "unknown";
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function readString(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: JsonObject, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
