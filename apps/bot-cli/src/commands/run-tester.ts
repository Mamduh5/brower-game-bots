import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, Finding, JsonObject, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import { createDefaultTesterEvaluators, createTesterBrain, ScenarioExecutor } from "@game-bots/agent-tester";
import type { EnvironmentHealth, ObservationFrame } from "@game-bots/environment-sdk";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import { toJsonReport } from "@game-bots/reporting";
import { SystemClock } from "@game-bots/runtime-core";
import { wordleWebPlugin } from "@game-bots/wordle-web";
import type { GameSnapshot } from "@game-bots/game-sdk";

import type { AppContainer } from "../bootstrap/container.js";

export interface TesterRunResult {
  run: RunRecord;
  events: readonly RunEvent[];
  findings: readonly Finding[];
  report: RunReport;
  artifacts: readonly ArtifactRef[];
}

function buildObservationPayload(frame: ObservationFrame, snapshot: GameSnapshot) {
  return {
    ...frame.payload,
    gameSnapshotTitle: snapshot.title,
    gameSnapshotTerminal: snapshot.isTerminal,
    gameSemanticState: snapshot.semanticState,
    gameMetrics: snapshot.metrics
  };
}

function buildHealthObservationPayload(health: EnvironmentHealth): JsonObject {
  return {
    healthStatus: health.status,
    healthCheckedAt: health.checkedAt,
    healthDetail: health.detail ?? "",
    healthSignals: health.signals
  };
}

function buildActionEventPayload(
  action: { kind: string; target?: { selector: string } },
  payload: JsonObject
): JsonObject {
  return {
    action: action.kind,
    ...(action.target ? { targetSelector: action.target.selector } : {}),
    ...payload
  };
}

function isTerminalPhase(phase: RunRecord["phase"]): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

function enrichFindingsWithArtifacts(findings: readonly Finding[], artifacts: readonly ArtifactRef[]): Finding[] {
  const artifactEvidence = artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    label: artifact.kind,
    detail: artifact.relativePath
  }));

  return findings.map((finding) => ({
    ...finding,
    evidence: [...finding.evidence, ...artifactEvidence]
  }));
}

export async function runTester(container: AppContainer): Promise<TesterRunResult> {
  const plugin = wordleWebPlugin;
  const brain = createTesterBrain();
  const scenarioExecutor = new ScenarioExecutor();
  const environmentPort = new PlaywrightEnvironmentPort({
    artifactStore: container.artifactStore
  });

  const request: RunRequest = {
    agentKind: "tester",
    gameId: plugin.manifest.gameId,
    environmentId: environmentPort.environmentId,
    profileId: "wordle-web.tester.smoke",
    scenarioId: "smoke",
    config: {}
  };

  let run = await container.runEngine.createRun(request);
  const logger = container.logger.child({
    runId: run.runId,
    agentKind: request.agentKind,
    gameId: request.gameId,
    scenarioId: request.scenarioId
  });
  const gameSession = await plugin.createSession(
    request.profileId
      ? {
          profileId: request.profileId
        }
      : {}
  );
  const environmentSession = await environmentPort.openSession();
  const scenario = await scenarioExecutor.execute(
    request.scenarioId
      ? {
          scenarioId: request.scenarioId,
          tags: []
        }
      : {
          tags: []
        },
    await gameSession.scenarios()
  );
  const evaluators = [...createDefaultTesterEvaluators(), ...(await gameSession.evaluators())];
  const clock = new SystemClock();
  const capturedArtifacts: ArtifactRef[] = [];
  const findings: Finding[] = [];
  let report: RunReport | null = null;

  logger.info({ selectedScenario: scenario.scenarioId }, "Starting tester run.");

  const collectFindings = async (event: RunEvent): Promise<void> => {
    const emitted = await Promise.all(
      evaluators.map((evaluator) =>
        evaluator.onEvent(event, {
          run,
          clock
        })
      )
    );

    findings.push(...emitted.flat());
  };

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
    const openingSnapshot = await gameSession.translate(openingFrame);
    const openingObservationEvent: RunEvent = {
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: new Date().toISOString(),
      type: "observation.captured",
      observationKind: "opening",
      summary: openingFrame.summary,
      payload: buildObservationPayload(openingFrame, openingSnapshot)
    };
    await container.runEngine.appendEvent(openingObservationEvent);
    await collectFindings(openingObservationEvent);

    const openingActions = await gameSession.actions(openingSnapshot);
    const openingDecision = await brain.decide({
      run,
      gameState: {
        title: openingSnapshot.title,
        isTerminal: openingSnapshot.isTerminal,
        ...openingSnapshot.semanticState
      },
      availableActions: openingActions,
      recentEvents: await container.runEngine.listEvents(run.runId)
    });

    if (openingDecision.type !== "game-action") {
      throw new Error(`Expected tester scenario to produce one semantic action, received ${openingDecision.type}.`);
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
      const actionEvent: RunEvent = {
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: actionResult.completedAt,
        type: "action.executed",
        actionKind: environmentAction.kind,
        status: actionResult.status,
        summary: actionResult.detail,
        payload: buildActionEventPayload(environmentAction, actionResult.payload)
      };

      await container.runEngine.appendEvent(actionEvent);
      await collectFindings(actionEvent);
    }

    const health = await environmentSession.health();
    const healthObservationEvent: RunEvent = {
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: health.checkedAt,
      type: "observation.captured",
      observationKind: "environment-health",
      summary: health.detail,
      payload: buildHealthObservationPayload(health)
    };
    await container.runEngine.appendEvent(healthObservationEvent);
    await collectFindings(healthObservationEvent);

    const screenshot = await environmentSession.capture({
      kind: "screenshot",
      name: "tester-after-submit"
    });
    capturedArtifacts.push(screenshot);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: screenshot.createdAt,
      type: "artifact.stored",
      artifact: screenshot
    });

    const domSnapshot = await environmentSession.capture({
      kind: "dom-snapshot",
      name: "tester-after-submit"
    });
    capturedArtifacts.push(domSnapshot);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: domSnapshot.createdAt,
      type: "artifact.stored",
      artifact: domSnapshot
    });

    const closingFrame = await environmentSession.observe({
      modes: ["dom", "console", "network"]
    });
    const closingSnapshot = await gameSession.translate(closingFrame);
    const closingObservationEvent: RunEvent = {
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: new Date().toISOString(),
      type: "observation.captured",
      observationKind: "post-action",
      summary: closingFrame.summary,
      payload: buildObservationPayload(closingFrame, closingSnapshot)
    };
    await container.runEngine.appendEvent(closingObservationEvent);
    await collectFindings(closingObservationEvent);

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
      throw new Error(`Expected tester scenario to complete after one cycle, received ${closingDecision.type}.`);
    }

    run = await container.runEngine.transitionPhase(run, "evaluating");
    const finalizedFindings = await Promise.all(
      evaluators.map((evaluator) =>
        evaluator.finalize({
          run,
          clock
        })
      )
    );
    findings.push(...finalizedFindings.flat());

    const enrichedFindings = enrichFindingsWithArtifacts(findings, capturedArtifacts);
    for (const finding of enrichedFindings) {
      await container.runEngine.appendEvent({
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: finding.createdAt,
        type: "evaluation.finding_created",
        finding
      });
    }

    run = await container.runEngine.transitionPhase(run, "reporting");
    report = container.reportBuilder.build({
      run,
      findings: enrichedFindings,
      evidence: capturedArtifacts,
      completedAt: clock.now()
    });
    await container.runEngine.saveReport(report);

    const reportArtifact = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "report",
        relativePath: `reports/${run.runId}.report.json`,
        contentType: "application/json"
      },
      Buffer.from(toJsonReport(report), "utf8")
    );
    capturedArtifacts.push(reportArtifact);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: reportArtifact.createdAt,
      type: "artifact.stored",
      artifact: reportArtifact
    });
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: clock.now().toISOString(),
      type: "report.generated",
      reportId: report.reportId,
      evidence: capturedArtifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        label: artifact.kind,
        detail: artifact.relativePath
      }))
    });

    run = await container.runEngine.completeRun(run);

    logger.info(
      {
        finalPhase: run.phase,
        findingCount: enrichedFindings.length,
        artifactCount: capturedArtifacts.length
      },
      "Completed tester run."
    );

    process.stdout.write(
      `Completed tester run ${run.runId} with ${enrichedFindings.length} findings and ${capturedArtifacts.length} artifacts.\n`
    );

    return {
      run,
      events: await container.runEngine.listEvents(run.runId),
      findings: enrichedFindings,
      report,
      artifacts: capturedArtifacts
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tester run failure.";
    logger.error({ err: error }, "Tester run failed.");

    if (!isTerminalPhase(run.phase)) {
      run = await container.runEngine.failRun(run, "tester_run_failed", message);
    }

    throw error;
  } finally {
    await environmentSession.stop("tester-run-finished");
    await brain.shutdown?.();
  }
}
