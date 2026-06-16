import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, JsonObject, JsonValue, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import {
  boardHashFromFen,
  chooseBeginnerChessMove,
  evaluateChessPosition,
  inferChessTurnState,
  type ChessBoardState,
  type ChessBotTurnStatus,
  type ChessColor,
  type ChessMoveChoice,
  type ChessPiece,
  type ChessPieceKind,
  type ChessTurnConfidence,
  type ChessTurnState
} from "@game-bots/agent-player";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import type { GameSnapshot } from "@game-bots/game-sdk";
import {
  CHESS_COM_BOARD_RUNTIME_PROBE,
  CHESS_COM_PLAYER_COMPUTER_PROFILE_ID,
  promotionQueenClickPoint,
  squareCenter
} from "@game-bots/chess-com-web";
import { toJsonReport } from "@game-bots/reporting";
import { SystemClock } from "@game-bots/runtime-core";

import type { AppContainer } from "../bootstrap/container.js";
import { resolveGamePlugin } from "../bootstrap/game-plugins.js";

export interface ChessComPlayerRunOptions {
  readonly opponent?: "computer";
  readonly maxMoves?: number;
  readonly headless?: boolean;
  readonly turnTimeoutMs?: number;
  readonly pollMs?: number;
}

type ChessComLoopState =
  | "bootstrapping"
  | "choosing-computer-mode"
  | "waiting-for-board"
  | "bot-turn-ready"
  | "executing-move"
  | "waiting-for-promotion"
  | "waiting-for-move-apply"
  | "waiting-for-opponent"
  | "waiting-for-bot-turn"
  | "game-ended"
  | "max-moves-reached"
  | "stopped-uncertain"
  | "failed";

export interface ChessComObservationRecord {
  readonly timestamp: string;
  readonly moveNumber: number;
  readonly loopState: ChessComLoopState;
  readonly fen: string | null;
  readonly boardHash: string | null;
  readonly sideToMove: ChessColor | null;
  readonly botTurnStatus: ChessBotTurnStatus;
  readonly botTurnConfidence: ChessTurnConfidence;
  readonly reason: string;
  readonly lastMove: string | null;
  readonly moveListLength: number | null;
  readonly boardChangedSinceLastObservation: boolean;
  readonly stableBoardCount: number;
  readonly promotionUiDetected: boolean;
  readonly promotionChoiceCount: number;
  readonly elapsedWaitMs: number;
  readonly screenshotPath: string | null;
}

export interface ChessComMoveRecord {
  readonly moveNumber: number;
  readonly playedAt: string;
  readonly botColor: ChessColor;
  readonly sideToMove: ChessColor | null;
  readonly beforeFen: string | null;
  readonly afterFen: string | null;
  readonly selectedMove: ChessMoveChoice;
  readonly selectedMoveSan: string;
  readonly selectedMoveUci: string;
  readonly selectedMoveScore: number;
  readonly selectedMoveReason: string;
  readonly selectedMovePromotion: ChessPieceKind | null;
  readonly promotionPiece: ChessPieceKind | null;
  readonly promotionUiDetected: boolean;
  readonly promotionChoiceApplied: boolean;
  readonly checkEvasionRequired: boolean;
  readonly checkEvasionMoveType: string | null;
  readonly topCandidateMoves: readonly JsonObject[];
  readonly materialBalanceBefore: number;
  readonly inCheck: boolean;
  readonly isCheckmate: boolean;
  readonly isStalemate: boolean;
  readonly boardBounds: JsonObject;
  readonly attemptedCoordinates: JsonObject;
  readonly moveApplied: boolean;
  readonly moveApplyFailed: boolean;
  readonly lastMove: string | null;
  readonly outcome: string | null;
  readonly beforeScreenshotPath: string | null;
  readonly afterScreenshotPath: string | null;
}

export interface ChessComRunResult {
  readonly run: RunRecord;
  readonly events: readonly RunEvent[];
  readonly report: RunReport;
  readonly moves: readonly ChessComMoveRecord[];
  readonly artifacts: readonly ArtifactRef[];
}

const DEFAULT_MAX_MOVES = 80;
const DEFAULT_TURN_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 750;
const REQUIRED_STABLE_BOARD_POLLS = 2;

export async function runPlayerChessCom(
  container: AppContainer,
  options: ChessComPlayerRunOptions = {}
): Promise<ChessComRunResult> {
  const opponent = options.opponent ?? "computer";
  if (opponent !== "computer") {
    throw new Error("Chess.com player only supports --opponent=computer. Human matchmaking is not allowed.");
  }

  const maxMoves = Math.max(1, Math.min(120, options.maxMoves ?? DEFAULT_MAX_MOVES));
  const headless = options.headless ?? true;
  const turnTimeoutMs = Math.max(2_000, Math.min(120_000, options.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS));
  const pollMs = Math.max(250, Math.min(5_000, options.pollMs ?? DEFAULT_POLL_MS));
  const plugin = resolveGamePlugin("chess-com-web");
  const environmentPort = new PlaywrightEnvironmentPort({
    artifactStore: container.artifactStore
  });
  const clock = new SystemClock();
  const request: RunRequest = {
    agentKind: "player",
    gameId: plugin.manifest.gameId,
    environmentId: environmentPort.environmentId,
    profileId: CHESS_COM_PLAYER_COMPUTER_PROFILE_ID,
    config: {
      opponent,
      maxMoves,
      headless,
      turnTimeoutMs,
      pollMs,
      safety: "computer-only"
    }
  };

  let run = await container.runEngine.createRun(request);
  const logger = container.logger.child({
    runId: run.runId,
    agentKind: request.agentKind,
    gameId: request.gameId,
    profileId: request.profileId
  });
  const session = await plugin.createSession({ profileId: CHESS_COM_PLAYER_COMPUTER_PROFILE_ID });
  const environmentSession = await environmentPort.openSession();
  const capturedArtifacts: ArtifactRef[] = [];
  const moves: ChessComMoveRecord[] = [];
  const observations: ChessComObservationRecord[] = [];
  let report: RunReport | null = null;
  let recentEvents: readonly RunEvent[] = [];
  let lastBotMoveFen: string | null = null;
  let lastObservationFen: string | null = null;
  let lastStableBoardHash: string | null = null;
  let stableBoardCount = 0;
  let stopReason: string | null = null;
  let finalLoopState: ChessComLoopState = "bootstrapping";

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
      name: `move-${String(moveNumber).padStart(2, "0")}-${label}`
    });
    await storeArtifactEvent(artifact);
    return artifact;
  };

  const observeAndRecord = async (
    moveNumber: number,
    loopState: ChessComLoopState,
    waitStartedAt: number,
    observationKind = "chess.turn.observed"
  ): Promise<{
    readonly snapshot: GameSnapshot;
    readonly board: ChessBoardState;
    readonly turn: ChessTurnState;
    readonly record: ChessComObservationRecord;
  }> => {
    finalLoopState = loopState;
    const frame = await environmentSession.observe({
      modes: ["dom", "screenshot", "console"],
      runtimeProbe: CHESS_COM_BOARD_RUNTIME_PROBE
    });
    const snapshot = await session.translate(frame);
    const board = applyTurnInference(boardStateFromSnapshot(snapshot), lastBotMoveFen, lastObservationFen);
    const outcome = readString(snapshot.semanticState.outcome);
    const turn = inferChessTurnState({
      boardDetected: snapshot.semanticState.boardDetected === true,
      fen: board.fen,
      sideToMove: board.sideToMove,
      botColor: board.botColor,
      lastBotMoveFen,
      previousObservationFen: lastObservationFen,
      outcome
    });
    if (turn.boardHash && turn.boardHash === lastStableBoardHash) {
      stableBoardCount += 1;
    } else {
      lastStableBoardHash = turn.boardHash;
      stableBoardCount = turn.boardHash ? 1 : 0;
    }
    const record: ChessComObservationRecord = {
      timestamp: clock.now().toISOString(),
      moveNumber,
      loopState,
      fen: board.fen,
      boardHash: turn.boardHash,
      sideToMove: board.sideToMove,
      botTurnStatus: turn.botTurnStatus,
      botTurnConfidence: turn.confidence,
      reason: turn.reason,
      lastMove: readString(snapshot.semanticState.lastMove),
      moveListLength: readNumber(snapshot.semanticState.moveListLength),
      boardChangedSinceLastObservation: turn.boardChangedSinceLastObservation,
      stableBoardCount,
      promotionUiDetected: snapshot.semanticState.promotionUiDetected === true,
      promotionChoiceCount: readNumber(snapshot.semanticState.promotionChoiceCount) ?? 0,
      elapsedWaitMs: Date.now() - waitStartedAt,
      screenshotPath: null
    };
    observations.push(record);
    if (board.fen) {
      lastObservationFen = board.fen;
    }
    await appendBoardEvent({
      appendTrackedEvent,
      nextSequence: () => container.runEngine.nextSequence(run.runId),
      run,
      clock,
      moveNumber,
      observationKind,
      snapshot,
      summary: `Chess.com ${loopState} observation for move ${moveNumber}.`,
      turn: record
    });
    return { snapshot, board, turn, record };
  };

  const waitForBotTurn = async (moveNumber: number): Promise<{
    readonly snapshot: GameSnapshot;
    readonly board: ChessBoardState;
    readonly turn: ChessTurnState;
    readonly record: ChessComObservationRecord;
  } | null> => {
    const waitStartedAt = Date.now();
    while (Date.now() - waitStartedAt <= turnTimeoutMs) {
      const state = await observeAndRecord(
        moveNumber,
        lastBotMoveFen ? "waiting-for-bot-turn" : "waiting-for-board",
        waitStartedAt
      );
      const safetyReason = readString(state.snapshot.semanticState.safetyReason);
      if (state.snapshot.semanticState.unsafeHumanMatchmaking === true) {
        throw new Error(`Refusing to continue: ${safetyReason ?? "Chess.com human matchmaking risk detected."}`);
      }
      if (state.snapshot.semanticState.outcome) {
        finalLoopState = "game-ended";
        stopReason = `game-ended:${readString(state.snapshot.semanticState.outcome) ?? "unknown"}`;
        return null;
      }
      if (state.turn.botTurnStatus === "bot-turn" && state.record.stableBoardCount >= REQUIRED_STABLE_BOARD_POLLS) {
        finalLoopState = "bot-turn-ready";
        return state;
      }
      await environmentSession.execute({ kind: "wait", durationMs: pollMs });
    }

    finalLoopState = "stopped-uncertain";
    stopReason = "turn-uncertain-timeout";
    const timeoutScreenshot = await captureArtifact(moveNumber, "turn-uncertain-timeout", "screenshot").catch(() => null);
    if (timeoutScreenshot && observations.length > 0) {
      const latest = observations[observations.length - 1];
      if (latest) {
        observations[observations.length - 1] = {
          ...latest,
          screenshotPath: timeoutScreenshot.relativePath
        };
      }
    }
    logger.info({ moveNumber, turnTimeoutMs }, "Stopped chess-com run because bot turn could not be proven.");
    return null;
  };

  const waitForMoveApply = async (
    moveNumber: number,
    beforeFen: string | null,
    selectedMove: ChessMoveChoice,
    beforeMoveListLength: number | null
  ): Promise<{
    readonly snapshot: GameSnapshot;
    readonly afterFen: string | null;
  }> => {
    const waitStartedAt = Date.now();
    let latest: { readonly snapshot: GameSnapshot; readonly board: ChessBoardState } | null = null;
    const expectedBoardHash = boardHashFromFen(selectedMove.resultingFen);
    while (Date.now() - waitStartedAt <= Math.min(10_000, turnTimeoutMs)) {
      const observed = await observeAndRecord(moveNumber, "waiting-for-move-apply", waitStartedAt, "chess.move.apply.observed");
      latest = observed;
      const afterFen = observed.board.fen;
      const afterBoardHash = boardHashFromFen(afterFen);
      const moveIsReflected = boardReflectsSelectedMove(afterFen, selectedMove, observed.board.botColor);
      const moveListAdvanced = beforeMoveListLength !== null && (observed.record.moveListLength ?? 0) > beforeMoveListLength;
      if (
        afterFen &&
        beforeFen &&
        afterFen !== beforeFen &&
        afterBoardHash &&
        (afterBoardHash === expectedBoardHash || moveIsReflected || moveListAdvanced) &&
        observed.record.stableBoardCount >= REQUIRED_STABLE_BOARD_POLLS
      ) {
        return { snapshot: observed.snapshot, afterFen };
      }
      await environmentSession.execute({ kind: "wait", durationMs: pollMs });
    }
    return {
      snapshot: latest?.snapshot ?? (await observeAndRecord(moveNumber, "waiting-for-move-apply", waitStartedAt, "chess.move.apply.observed")).snapshot,
      afterFen: latest?.board.fen ?? null
    };
  };

  const handlePromotionIfNeeded = async (
    moveNumber: number,
    selectedMove: ChessMoveChoice,
    bounds: JsonObject,
    orientation: ChessColor
  ): Promise<{
    readonly promotionUiDetected: boolean;
    readonly promotionChoiceApplied: boolean;
  }> => {
    if (!selectedMove.promotion) {
      return { promotionUiDetected: false, promotionChoiceApplied: false };
    }

    const waitStartedAt = Date.now();
    let latestPromotionUiDetected = false;
    let latestQueenBounds: Record<string, unknown> = {};
    await environmentSession.execute({ kind: "wait", durationMs: Math.min(500, pollMs) });

    while (Date.now() - waitStartedAt <= Math.min(5_000, turnTimeoutMs)) {
      const observed = await observeAndRecord(moveNumber, "waiting-for-promotion", waitStartedAt, "chess.promotion.observed");
      latestPromotionUiDetected ||= observed.snapshot.semanticState.promotionUiDetected === true;
      latestQueenBounds = asRecord(observed.snapshot.semanticState.promotionQueenBounds);
      if (latestPromotionUiDetected) {
        break;
      }
      const observedBoardHash = boardHashFromFen(observed.board.fen);
      const expectedBoardHash = boardHashFromFen(selectedMove.resultingFen);
      if (observedBoardHash && expectedBoardHash && observedBoardHash === expectedBoardHash && observed.record.stableBoardCount >= REQUIRED_STABLE_BOARD_POLLS) {
        return { promotionUiDetected: false, promotionChoiceApplied: false };
      }
      await environmentSession.execute({ kind: "wait", durationMs: pollMs });
    }

    const queenPoint = centerFromBounds(latestQueenBounds) ?? promotionQueenClickPoint(selectedMove.to, boundsFromRecord(bounds), orientation);
    if (!queenPoint) {
      const artifact = await captureArtifact(moveNumber, "promotion-choice-missing", "screenshot").catch(() => null);
      if (artifact && observations.length > 0) {
        const latest = observations[observations.length - 1];
        if (latest) {
          observations[observations.length - 1] = { ...latest, screenshotPath: artifact.relativePath };
        }
      }
      return { promotionUiDetected: latestPromotionUiDetected, promotionChoiceApplied: false };
    }

    await environmentSession.execute({ kind: "mouse-click", point: queenPoint });
    await appendTrackedEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: clock.now().toISOString(),
      type: "action.executed",
      actionKind: "mouse-click",
      status: "succeeded",
      summary: `Selected Chess.com queen promotion for ${selectedMove.lan}.`,
      payload: {
        semanticActionId: "choose-promotion-piece",
        promotionPiece: "queen",
        promotionUiDetected: latestPromotionUiDetected,
        point: queenPoint
      }
    });
    await environmentSession.execute({ kind: "wait", durationMs: Math.min(750, pollMs) });
    return { promotionUiDetected: latestPromotionUiDetected, promotionChoiceApplied: true };
  };

  logger.info({ opponent, maxMoves, headless, turnTimeoutMs, pollMs }, "Starting chess-com player run.");

  try {
    run = await container.runEngine.transitionPhase(run, "preparing");
    run = await container.runEngine.transitionPhase(run, "environment_starting");
    await environmentSession.start({
      runId: run.runId,
      headless,
      viewport: {
        width: 1365,
        height: 900
      }
    });

    run = await container.runEngine.transitionPhase(run, "game_bootstrap");
    await session.bootstrap(environmentSession);
    run = await container.runEngine.transitionPhase(run, "executing");

    for (let moveNumber = 1; moveNumber <= maxMoves; moveNumber += 1) {
      const readyState = await waitForBotTurn(moveNumber);
      if (!readyState) {
        break;
      }

      const beforeSnapshot = readyState.snapshot;
      const board = readyState.board;
      const selectedMove = chooseBeginnerChessMove(board);
      if (!selectedMove) {
        const evaluation = evaluateChessPosition(board);
        if (evaluation?.isCheckmate || evaluation?.isStalemate) {
          finalLoopState = "game-ended";
          stopReason = evaluation.isCheckmate ? "game-ended:checkmate" : "game-ended:stalemate";
          break;
        }
        finalLoopState = "stopped-uncertain";
        stopReason = "no-legal-move-for-proven-bot-turn";
        logger.info({ moveNumber, fen: board.fen }, "No conservative Chess.com move available; stopping safely.");
        break;
      }

      finalLoopState = "executing-move";
      const bounds = asRecord(beforeSnapshot.semanticState.boardBounds);
      const orientation = readString(beforeSnapshot.semanticState.orientation) === "black" ? "black" : "white";
      const fromPoint = squareCenter(selectedMove.from, boundsFromRecord(bounds), orientation);
      const toPoint = squareCenter(selectedMove.to, boundsFromRecord(bounds), orientation);
      const beforeScreenshot = await captureArtifact(moveNumber, "before-move", "screenshot");
      const actions = await session.resolveAction(
        {
          actionId: "execute-chess-move",
          params: {
            from: selectedMove.from,
            to: selectedMove.to,
            orientation,
            boardBounds: toJsonValue(bounds)
          }
        },
        beforeSnapshot
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
        actionKind: "mouse-drag",
        status: "succeeded",
        summary: `Played Chess.com move ${selectedMove.lan}.`,
        payload: {
          semanticActionId: "execute-chess-move",
          semanticActionParams: toJsonValue(selectedMove),
          beforeFen: board.fen,
          promotionPiece: selectedMove.promotionPiece,
          checkEvasionRequired: selectedMove.checkEvasionRequired,
          checkEvasionMoveType: selectedMove.checkEvasionMoveType
        }
      });

      const promotionResult = await handlePromotionIfNeeded(moveNumber, selectedMove, bounds as JsonObject, orientation);
      finalLoopState = "waiting-for-move-apply";
      const beforeMoveListLength = readNumber(beforeSnapshot.semanticState.moveListLength);
      const applied = await waitForMoveApply(moveNumber, board.fen, selectedMove, beforeMoveListLength);
      const afterSnapshot = applied.snapshot;
      const afterScreenshot = await captureArtifact(moveNumber, "after-move", "screenshot");
      const afterFen = applied.afterFen ?? readString(afterSnapshot.semanticState.fen);
      const moveApplied = Boolean(
        afterFen &&
          board.fen &&
          afterFen !== board.fen &&
          (boardHashFromFen(afterFen) === boardHashFromFen(selectedMove.resultingFen) ||
            boardReflectsSelectedMove(afterFen, selectedMove, board.botColor) ||
            moveListAdvanced(beforeMoveListLength, readNumber(afterSnapshot.semanticState.moveListLength)))
      );
      await appendBoardEvent({
        appendTrackedEvent,
        nextSequence: () => container.runEngine.nextSequence(run.runId),
        run,
        clock,
        moveNumber,
        observationKind: "chess.move.completed",
        snapshot: afterSnapshot,
        summary: `Chess.com move ${selectedMove.lan} completed.`
      });

      const moveRecord: ChessComMoveRecord = {
        moveNumber,
        playedAt: clock.now().toISOString(),
        botColor: board.botColor,
        sideToMove: board.sideToMove,
        beforeFen: board.fen,
        afterFen,
        selectedMove,
        selectedMoveSan: selectedMove.san,
        selectedMoveUci: selectedMove.uci,
        selectedMoveScore: selectedMove.score,
        selectedMoveReason: selectedMove.reason,
        selectedMovePromotion: selectedMove.promotion,
        promotionPiece: selectedMove.promotionPiece,
        promotionUiDetected: promotionResult.promotionUiDetected,
        promotionChoiceApplied: promotionResult.promotionChoiceApplied,
        checkEvasionRequired: selectedMove.checkEvasionRequired,
        checkEvasionMoveType: selectedMove.checkEvasionMoveType,
        topCandidateMoves: selectedMove.topCandidates.map((candidate) => toJsonValue(candidate) as JsonObject),
        materialBalanceBefore: selectedMove.materialBalanceBefore,
        inCheck: selectedMove.inCheck,
        isCheckmate: selectedMove.isCheckmate,
        isStalemate: selectedMove.isStalemate,
        boardBounds: bounds as JsonObject,
        attemptedCoordinates: {
          from: fromPoint,
          to: toPoint
        } as JsonObject,
        moveApplied,
        moveApplyFailed: !moveApplied,
        lastMove: readString(afterSnapshot.semanticState.lastMove),
        outcome: readString(afterSnapshot.semanticState.outcome),
        beforeScreenshotPath: beforeScreenshot.relativePath,
        afterScreenshotPath: afterScreenshot.relativePath
      };
      moves.push(moveRecord);

      logger.info({ moveNumber, selectedMove, beforeFen: board.fen, afterFen: moveRecord.afterFen, moveApplied }, "Played chess-com move.");

      if (moveRecord.outcome) {
        finalLoopState = "game-ended";
        stopReason = `game-ended:${moveRecord.outcome}`;
        break;
      }
      if (!moveApplied) {
        finalLoopState = "stopped-uncertain";
        stopReason = "move-apply-timeout";
        break;
      }
      lastBotMoveFen = selectedMove.resultingFen;
      finalLoopState = "waiting-for-opponent";
      if (moveNumber === maxMoves) {
        finalLoopState = "max-moves-reached";
        stopReason = "max-moves-reached";
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

    const summaryArtifact = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "json",
        relativePath: "reports/02-chess-com-player-summary.json",
        contentType: "application/json"
      },
      Buffer.from(
        JSON.stringify(
          buildChessSummaryJson({
            run,
            report,
            moves,
            observations,
            artifacts: capturedArtifacts,
            stopReason,
            finalLoopState,
            options: { opponent, maxMoves, headless, turnTimeoutMs, pollMs }
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
    logger.info({ moveCount: moves.length, artifactCount: capturedArtifacts.length }, "Completed chess-com player run.");
    process.stdout.write(`Completed chess-com player run ${run.runId} with ${moves.length} move(s) and ${capturedArtifacts.length} artifacts.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Chess.com player run failed.");
    run = await container.runEngine.failRun(run, "CHESS_COM_PLAYER_RUN_FAILED", message);
    throw error;
  } finally {
    await environmentSession.stop("chess-com-player-run-finished").catch(() => undefined);
  }

  if (!report) {
    throw new Error("Chess.com player run did not produce a report.");
  }

  return {
    run,
    events: recentEvents,
    report,
    moves,
    artifacts: capturedArtifacts
  };
}

function boardStateFromSnapshot(snapshot: GameSnapshot): ChessBoardState {
  const pieces = Array.isArray(snapshot.semanticState.pieces) ? snapshot.semanticState.pieces : [];
  const pieceMap: Record<string, ChessPiece> = {};
  for (const piece of pieces) {
    const record = asRecord(piece);
    const square = readString(record.square);
    const color = readString(record.color);
    const kind = readString(record.kind);
    if (square && (color === "white" || color === "black") && isChessPieceKind(kind)) {
      pieceMap[square] = { color, kind };
    }
  }
  const botColor = readString(snapshot.semanticState.botColor) === "black" ? "black" : "white";
  const sideToMove = readString(snapshot.semanticState.sideToMove);
  return {
    pieces: pieceMap,
    botColor,
    sideToMove: sideToMove === "white" || sideToMove === "black" ? sideToMove : null,
    fen: readString(snapshot.semanticState.fen)
  };
}

function applyTurnInference(
  board: ChessBoardState,
  lastBotMoveFen: string | null,
  previousObservationFen: string | null
): ChessBoardState {
  const turn = inferChessTurnState({
    boardDetected: Boolean(board.fen),
    fen: board.fen,
    sideToMove: board.sideToMove,
    botColor: board.botColor,
    lastBotMoveFen,
    previousObservationFen
  });
  if (board.sideToMove || !board.fen || turn.botTurnStatus !== "bot-turn") {
    return board;
  }
  return {
    ...board,
    sideToMove: board.botColor,
    fen: withActiveColor(board.fen, board.botColor)
  };
}

function withActiveColor(fen: string, color: ChessColor): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) {
    return fen;
  }
  parts[1] = color === "black" ? "b" : "w";
  return parts.join(" ");
}

function buildChessSummaryJson(input: {
  readonly run: RunRecord;
  readonly report: RunReport;
  readonly moves: readonly ChessComMoveRecord[];
  readonly observations: readonly ChessComObservationRecord[];
  readonly artifacts: readonly ArtifactRef[];
  readonly stopReason: string | null;
  readonly finalLoopState: ChessComLoopState;
  readonly options: Required<ChessComPlayerRunOptions>;
}): JsonObject {
  return {
    run: input.run as unknown as JsonObject,
    report: input.report as unknown as JsonObject,
    summary: {
      gameId: input.run.gameId,
      opponent: input.options.opponent,
      maxMoves: input.options.maxMoves,
      headless: input.options.headless,
      turnTimeoutMs: input.options.turnTimeoutMs,
      pollMs: input.options.pollMs,
      movesPlayed: input.moves.length,
      outcome: input.moves.at(-1)?.outcome ?? null,
      stopReason: input.stopReason,
      finalLoopState: input.finalLoopState,
      safety: "computer-only"
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

async function appendBoardEvent(input: {
  readonly appendTrackedEvent: (event: RunEvent) => Promise<void>;
  readonly nextSequence: () => Promise<number>;
  readonly run: RunRecord;
  readonly clock: SystemClock;
  readonly moveNumber: number;
  readonly observationKind: string;
  readonly snapshot: GameSnapshot;
  readonly summary: string;
  readonly turn?: ChessComObservationRecord;
}): Promise<void> {
  await input.appendTrackedEvent({
    eventId: randomUUID(),
    runId: input.run.runId,
    sequence: await input.nextSequence(),
    timestamp: input.clock.now().toISOString(),
    type: "observation.captured",
    observationKind: input.observationKind,
    summary: input.summary,
    payload: {
      moveNumber: input.moveNumber,
      gameSemanticState: toJsonValue(input.snapshot.semanticState),
      ...(input.turn ? { chessTurn: toJsonValue(input.turn) } : {})
    }
  });
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundsFromRecord(record: Record<string, unknown>): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: typeof record.x === "number" ? record.x : 0,
    y: typeof record.y === "number" ? record.y : 0,
    width: typeof record.width === "number" ? record.width : 0,
    height: typeof record.height === "number" ? record.height : 0
  };
}

function centerFromBounds(record: Record<string, unknown>): { readonly x: number; readonly y: number } | null {
  const x = typeof record.x === "number" ? record.x : null;
  const y = typeof record.y === "number" ? record.y : null;
  const width = typeof record.width === "number" ? record.width : null;
  const height = typeof record.height === "number" ? record.height : null;
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: x + width / 2,
    y: y + height / 2
  };
}

function boardReflectsSelectedMove(fen: string | null, move: ChessMoveChoice, botColor: ChessColor): boolean {
  const pieces = pieceMapFromFen(fen);
  const target = pieces[move.to];
  if (!target) {
    return false;
  }
  const expectedKind = move.promotion ?? move.piece;
  if (target.color !== botColor || target.kind !== expectedKind) {
    return false;
  }
  const source = pieces[move.from];
  return !(source?.color === botColor && source.kind === move.piece);
}

function moveListAdvanced(before: number | null, after: number | null): boolean {
  return before !== null && after !== null && after > before;
}

function pieceMapFromFen(fen: string | null): Record<string, ChessPiece> {
  const placement = fen?.trim().split(/\s+/)[0];
  if (!placement) {
    return {};
  }
  const pieces: Record<string, ChessPiece> = {};
  const ranks = placement.split("/");
  for (let rankIndex = 0; rankIndex < ranks.length; rankIndex += 1) {
    const rankText = ranks[rankIndex] ?? "";
    const rank = 8 - rankIndex;
    let fileIndex = 0;
    for (const char of rankText) {
      if (/\d/.test(char)) {
        fileIndex += Number(char);
        continue;
      }
      const file = "abcdefgh"[fileIndex];
      const kind = pieceKindFromFenChar(char);
      if (file && kind) {
        pieces[`${file}${rank}`] = {
          color: char === char.toUpperCase() ? "white" : "black",
          kind
        };
      }
      fileIndex += 1;
    }
  }
  return pieces;
}

function pieceKindFromFenChar(char: string): ChessPieceKind | null {
  switch (char.toLowerCase()) {
    case "p":
      return "pawn";
    case "n":
      return "knight";
    case "b":
      return "bishop";
    case "r":
      return "rook";
    case "q":
      return "queen";
    case "k":
      return "king";
    default:
      return null;
  }
}

function isChessPieceKind(value: string | null): value is ChessPiece["kind"] {
  return value === "pawn" || value === "knight" || value === "bishop" || value === "rook" || value === "queen" || value === "king";
}
