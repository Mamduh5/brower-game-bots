import { randomUUID } from "node:crypto";

import type { ArtifactRef, RunEvent, RunRecord, RunRequest } from "@game-bots/contracts";
import { createPlayerBrain } from "@game-bots/agent-player";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import { wordleWebPlugin } from "@game-bots/wordle-web";

import type { AppContainer } from "../bootstrap/container.js";

export interface PlayerRunResult {
  run: RunRecord;
  events: readonly RunEvent[];
  artifacts: readonly ArtifactRef[];
}

function isTerminalPhase(phase: RunRecord["phase"]): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

export async function runPlayer(container: AppContainer): Promise<PlayerRunResult> {
  const plugin = wordleWebPlugin;
  const brain = createPlayerBrain();
  const environmentPort = new PlaywrightEnvironmentPort({
    artifactStore: container.artifactStore
  });

  const request: RunRequest = {
    agentKind: "player",
    gameId: plugin.manifest.gameId,
    environmentId: environmentPort.environmentId,
    profileId: "wordle-web.player.default",
    config: {}
  };

  let run = await container.runEngine.createRun(request);
  const logger = container.logger.child({
    runId: run.runId,
    agentKind: request.agentKind,
    gameId: request.gameId
  });
  const gameSession = await plugin.createSession(
    request.profileId
      ? {
          profileId: request.profileId
        }
      : {}
  );
  const environmentSession = await environmentPort.openSession();
  const storedArtifacts: ArtifactRef[] = [];

  logger.info("Starting player run.");

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
    await gameSession.bootstrap(environmentSession);

    run = await container.runEngine.transitionPhase(run, "executing");

    const openingFrame = await environmentSession.observe({
      modes: ["dom", "console", "network"]
    });
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: new Date().toISOString(),
      type: "observation.captured",
      observationKind: "opening",
      summary: openingFrame.summary,
      payload: openingFrame.payload
    });

    const openingSnapshot = await gameSession.translate(openingFrame);
    const availableActions = await gameSession.actions(openingSnapshot);
    const openingDecision = await brain.decide({
      run,
      gameState: {
        title: openingSnapshot.title,
        isTerminal: openingSnapshot.isTerminal,
        ...openingSnapshot.semanticState
      },
      availableActions,
      recentEvents: await container.runEngine.listEvents(run.runId)
    });

    if (openingDecision.type !== "game-action") {
      throw new Error(`Expected a semantic game action, received ${openingDecision.type}.`);
    }

    const environmentActions = await gameSession.resolveAction(
      {
        actionId: openingDecision.actionId,
        params: openingDecision.params
      },
      openingSnapshot
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
          ...actionResult.payload
        }
      });
    }

    const screenshot = await environmentSession.capture({
      kind: "screenshot",
      name: "after-submit"
    });
    storedArtifacts.push(screenshot);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: screenshot.createdAt,
      type: "artifact.stored",
      artifact: screenshot
    });

    const closingFrame = await environmentSession.observe({
      modes: ["dom", "console", "network"]
    });
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: new Date().toISOString(),
      type: "observation.captured",
      observationKind: "post-action",
      summary: closingFrame.summary,
      payload: closingFrame.payload
    });

    const closingSnapshot = await gameSession.translate(closingFrame);
    const closingActions = await gameSession.actions(closingSnapshot);
    const closingDecision = await brain.decide({
      run,
      gameState: {
        title: closingSnapshot.title,
        isTerminal: closingSnapshot.isTerminal,
        ...closingSnapshot.semanticState
      },
      availableActions: closingActions,
      recentEvents: await container.runEngine.listEvents(run.runId)
    });

    if (closingDecision.type !== "complete") {
      throw new Error(`Expected the run to complete after one semantic cycle, received ${closingDecision.type}.`);
    }

    run = await container.runEngine.transitionPhase(run, "evaluating");
    run = await container.runEngine.transitionPhase(run, "reporting");
    run = await container.runEngine.completeRun(run);

    logger.info(
      {
        finalPhase: run.phase,
        artifactCount: storedArtifacts.length
      },
      "Completed player run."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown player run failure.";
    logger.error({ err: error }, "Player run failed.");

    if (!isTerminalPhase(run.phase)) {
      run = await container.runEngine.failRun(run, "player_run_failed", message);
    }

    throw error;
  } finally {
    await environmentSession.stop("player-run-finished");
    await brain.shutdown?.();
  }

  const events = await container.runEngine.listEvents(run.runId);
  process.stdout.write(`Completed player run ${run.runId} with ${events.length} events.\n`);

  return {
    run,
    events,
    artifacts: storedArtifacts
  };
}
