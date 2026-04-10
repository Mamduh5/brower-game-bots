import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, JsonObject, JsonValue, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import {
  buildCatAndDogAttemptStrategy,
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

export interface CatAndDogPlayerAttemptRecord {
  attemptNumber: number;
  startedAt: string;
  endedAt: string;
  outcome: AttemptOutcome;
  note: string;
  strategy: CatAndDogAttemptStrategy;
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
const DEFAULT_MAX_STEPS_PER_ATTEMPT = 24;

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
    selectedWeaponKey: toJsonValue(snapshot.semanticState.selectedWeaponKey),
    modeLabelText: toJsonValue(snapshot.semanticState.modeLabelText),
    endVisible: toJsonValue(snapshot.semanticState.endVisible),
    endTitleText: toJsonValue(snapshot.semanticState.endTitleText),
    endSubtitleText: toJsonValue(snapshot.semanticState.endSubtitleText),
    outcome: toJsonValue(snapshot.semanticState.outcome)
  };
}

function buildAttemptNote(snapshot: GameSnapshot, fallback: string): string {
  if (snapshot.semanticState.endTitleText && typeof snapshot.semanticState.endTitleText === "string") {
    return snapshot.semanticState.endTitleText;
  }

  return fallback;
}

function buildPlayerSummaryJson(input: {
  run: RunRecord;
  report: RunReport;
  attempts: readonly CatAndDogPlayerAttemptRecord[];
  options: Required<Pick<CatAndDogPlayerRunOptions, "maxAttempts" | "stopOnWin" | "strategyMode">>;
  artifacts: readonly ArtifactRef[];
}): JsonObject {
  const winningAttempt = input.attempts.find((attempt) => attempt.outcome === "WIN") ?? null;

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
      ...(winningAttempt ? { winningAttemptNumber: winningAttempt.attemptNumber } : {}),
      ...(winningAttempt ? { winningStrategy: toJsonValue(winningAttempt.strategy) } : {}),
      reportId: input.report.reportId,
      artifactCount: input.artifacts.length
    },
    attempts: input.attempts.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      outcome: attempt.outcome,
      note: attempt.note,
      strategy: toJsonValue(attempt.strategy),
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
      const strategy = buildCatAndDogAttemptStrategy({
        attemptNumber,
        strategyMode
      });
      const attemptArtifacts: ArtifactRef[] = [];
      const attemptStartedAt = clock.now().toISOString();
      const attemptLogger = logger.child({
        attemptNumber,
        strategyMode,
        strategy
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
          strategyMode
        }
      });

      await gameSession.bootstrap(environmentSession);

      const openingFrame = await environmentSession.observe({
        modes: ["dom", "console", "network"]
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

      for (let step = 1; step <= maxStepsPerAttempt; step += 1) {
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
          modes: ["dom", "console", "network"]
        });
        currentSnapshot = await gameSession.translate(postActionFrame);
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

      const attemptEndedAt = clock.now().toISOString();
      const attemptRecord: CatAndDogPlayerAttemptRecord = {
        attemptNumber,
        startedAt: attemptStartedAt,
        endedAt: attemptEndedAt,
        outcome,
        note,
        strategy,
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
          note,
          strategy: toJsonValue(strategy),
          actionHistory: toJsonValue(actionHistory),
          finalState: summarizeFinalState(currentSnapshot),
          artifacts: attemptRecord.artifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            kind: artifact.kind,
            relativePath: artifact.relativePath
          }))
        }
      });

      attemptLogger.info({ outcome, note }, "Completed cat-and-dog player attempt.");

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
