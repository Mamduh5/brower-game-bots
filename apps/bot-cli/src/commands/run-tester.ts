import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { ArtifactRef, Finding, JsonObject, RunEvent, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";
import { createDefaultTesterEvaluators, createTesterBrain, ScenarioExecutor } from "@game-bots/agent-tester";
import {
  DEFAULT_CLICK_PROBE_SAMPLE_POINTS,
  type ClickProbeSampleResult,
  type EnvironmentHealth,
  type ObservationFrame
} from "@game-bots/environment-sdk";
import { PlaywrightEnvironmentPort } from "@game-bots/environment-playwright";
import { toJsonReport } from "@game-bots/reporting";
import { SystemClock } from "@game-bots/runtime-core";
import type { GameSnapshot } from "@game-bots/game-sdk";

import type { AppContainer } from "../bootstrap/container.js";
import { resolveGamePlugin, resolveTesterDefaults } from "../bootstrap/game-plugins.js";
import { finalizeFindingsQuality, withEvaluatorMetadata } from "./finding-quality.js";
import { buildArtifactCaptureName, buildArtifactIndex } from "./run-artifact-index.js";

export interface TesterRunResult {
  run: RunRecord;
  events: readonly RunEvent[];
  findings: readonly Finding[];
  report: RunReport;
  artifacts: readonly ArtifactRef[];
}

export interface TesterRunOptions {
  gameId?: string;
  profileId?: string;
  scenarioId?: string;
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

function toJsonSampleResults(
  sampleResults: readonly ClickProbeSampleResult[]
): JsonObject["sampleResults"] {
  return sampleResults.map((sample) => ({
    label: sample.label,
    xRatio: sample.xRatio,
    yRatio: sample.yRatio,
    absoluteX: sample.absoluteX,
    absoluteY: sample.absoluteY,
    matched: sample.matched,
    clickStatus: sample.clickStatus,
    ...(sample.detail ? { detail: sample.detail } : {})
  }));
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

function byArtifactPath(left: ArtifactRef, right: ArtifactRef): number {
  return left.relativePath.localeCompare(right.relativePath);
}

const MAX_TESTER_ACTION_CYCLES = 4;

function toJsonValue(value: unknown): JsonObject | string | number | boolean | null | JsonObject[] | (string | number | boolean | null)[] {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item)) as JsonObject[] | (string | number | boolean | null)[];
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)])
    ) as JsonObject;
  }

  return String(value);
}

export async function runTester(container: AppContainer, options: TesterRunOptions = {}): Promise<TesterRunResult> {
  const gameId = options.gameId ?? "wordle-web";
  const plugin = resolveGamePlugin(gameId);
  const testerDefaults = resolveTesterDefaults(plugin.manifest.gameId);
  const brain = createTesterBrain();
  const scenarioExecutor = new ScenarioExecutor();
  const environmentPort = new PlaywrightEnvironmentPort({
    artifactStore: container.artifactStore
  });

  const request: RunRequest = {
    agentKind: "tester",
    gameId: plugin.manifest.gameId,
    environmentId: environmentPort.environmentId,
    profileId: options.profileId ?? testerDefaults.profileId,
    scenarioId: options.scenarioId ?? testerDefaults.scenarioId,
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
    for (const evaluator of evaluators) {
      const emitted = await evaluator.onEvent(event, {
        run,
        clock
      });

      findings.push(...emitted.map((finding) => withEvaluatorMetadata(finding, evaluator.id)));
    }
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

    for (const clickProbe of scenario.clickProbes) {
      const probeResult = await environmentSession.probeClickability({
        probeId: clickProbe.probeId,
        surfaceSelector: clickProbe.surfaceSelector,
        ...(clickProbe.activationSelector ? { activationSelector: clickProbe.activationSelector } : {}),
        samplePoints: clickProbe.samplePoints ? [...clickProbe.samplePoints] : [...DEFAULT_CLICK_PROBE_SAMPLE_POINTS]
      });

      const clickProbeEvent: RunEvent = {
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: probeResult.measuredAt,
        type: "observation.captured",
        observationKind: "click-probe",
        summary: probeResult.summary,
        payload: {
          probeId: clickProbe.probeId,
          description: clickProbe.description,
          surfaceSelector: clickProbe.surfaceSelector,
          ...(clickProbe.activationSelector ? { activationSelector: clickProbe.activationSelector } : {}),
          minimumSuccessRatio: clickProbe.minimumSuccessRatio,
          successRatio: probeResult.successRatio,
          totalSamples: probeResult.totalSamples,
          successfulSamples: probeResult.successfulSamples,
          sampleResults: toJsonSampleResults(probeResult.sampleResults),
          ...(probeResult.visibleBounds ? { visibleBounds: probeResult.visibleBounds } : {})
        }
      };

      await container.runEngine.appendEvent(clickProbeEvent);
      await collectFindings(clickProbeEvent);
    }

    let previousSnapshot = openingSnapshot;
    let previousObservationEvent = openingObservationEvent;
    let actionCycle = 0;

    while (true) {
      const availableActions = await gameSession.actions(previousSnapshot);
      if (availableActions.length === 0) {
        break;
      }

      actionCycle += 1;
      if (actionCycle > MAX_TESTER_ACTION_CYCLES) {
        throw new Error(`Tester run exceeded max action cycles (${MAX_TESTER_ACTION_CYCLES}).`);
      }

      const decision = await brain.decide({
        run,
        gameState: {
          title: previousSnapshot.title,
          isTerminal: previousSnapshot.isTerminal,
          ...previousSnapshot.semanticState
        },
        availableActions,
        recentEvents: await container.runEngine.listEvents(run.runId)
      });

      if (decision.type !== "game-action") {
        throw new Error(`Expected tester scenario to produce a semantic action, received ${decision.type}.`);
      }

      const environmentActions = await gameSession.resolveAction(
        {
          actionId: decision.actionId,
          params: decision.params
        },
        previousSnapshot
      );
      const actionEventIds: string[] = [];

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
        actionEventIds.push(actionEvent.eventId);
      }

      const postActionFrame = await environmentSession.observe({
        modes: ["dom", "console", "network"]
      });
      const postActionSnapshot = await gameSession.translate(postActionFrame);
      const postActionObservationEvent: RunEvent = {
        eventId: randomUUID(),
        runId: run.runId,
        sequence: await container.runEngine.nextSequence(run.runId),
        timestamp: new Date().toISOString(),
        type: "observation.captured",
        observationKind: "post-action",
        summary: postActionFrame.summary,
        payload: buildObservationPayload(postActionFrame, postActionSnapshot)
      };
      await container.runEngine.appendEvent(postActionObservationEvent);
      await collectFindings(postActionObservationEvent);

      const matchingExpectation = scenario.actionExpectations.find(
        (expectation) => expectation.actionId === decision.actionId
      );
      if (matchingExpectation) {
        const stateExpectationEvent: RunEvent = {
          eventId: randomUUID(),
          runId: run.runId,
          sequence: await container.runEngine.nextSequence(run.runId),
          timestamp: new Date().toISOString(),
          type: "observation.captured",
          observationKind: "state-expectation",
          summary: matchingExpectation.description,
          payload: {
            actionId: decision.actionId,
            description: matchingExpectation.description,
            effects: matchingExpectation.effects.map((effect) => ({
              effectId: effect.effectId,
              description: effect.description,
              path: effect.path,
              operator: effect.operator,
              ...(effect.expectedValue !== undefined ? { expectedValue: toJsonValue(effect.expectedValue) } : {})
            })),
            preState: previousSnapshot.semanticState,
            postState: postActionSnapshot.semanticState,
            preObservationEventId: previousObservationEvent.eventId,
            postObservationEventId: postActionObservationEvent.eventId,
            actionEventIds
          }
        };
        await container.runEngine.appendEvent(stateExpectationEvent);
        await collectFindings(stateExpectationEvent);
      }

      previousSnapshot = postActionSnapshot;
      previousObservationEvent = postActionObservationEvent;
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
      name: buildArtifactCaptureName(40, "post-action-screen")
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
      name: buildArtifactCaptureName(41, "post-action-dom")
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

    const closingActions = await gameSession.actions(previousSnapshot);
    const closingDecision = await brain.decide({
      run,
      gameState: {
        title: previousSnapshot.title,
        isTerminal: previousSnapshot.isTerminal,
        ...previousSnapshot.semanticState
      },
      availableActions: closingActions,
      recentEvents: await container.runEngine.listEvents(run.runId)
    });

    if (closingDecision.type !== "complete") {
      throw new Error(`Expected tester scenario to complete after action cycles, received ${closingDecision.type}.`);
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
    for (const [evaluatorIndex, evaluator] of evaluators.entries()) {
      const emitted = finalizedFindings[evaluatorIndex] ?? [];
      findings.push(...emitted.map((finding) => withEvaluatorMetadata(finding, evaluator.id)));
    }

    const qualityFindings = finalizeFindingsQuality(findings, capturedArtifacts);
    for (const finding of qualityFindings) {
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
      findings: qualityFindings,
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
    capturedArtifacts.push(reportArtifact);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: reportArtifact.createdAt,
      type: "artifact.stored",
      artifact: reportArtifact
    });

    const eventsForIndex = await container.runEngine.listEvents(run.runId);
    const artifactIndexPayload = buildArtifactIndex({
      run,
      artifacts: [...capturedArtifacts].sort(byArtifactPath),
      findings: qualityFindings,
      events: eventsForIndex
    });
    const artifactIndex = await container.artifactStore.put(
      {
        runId: run.runId,
        kind: "json",
        relativePath: "reports/02-artifact-index.json",
        contentType: "application/json"
      },
      Buffer.from(JSON.stringify(artifactIndexPayload, null, 2), "utf8")
    );
    capturedArtifacts.push(artifactIndex);
    await container.runEngine.appendEvent({
      eventId: randomUUID(),
      runId: run.runId,
      sequence: await container.runEngine.nextSequence(run.runId),
      timestamp: artifactIndex.createdAt,
      type: "artifact.stored",
      artifact: artifactIndex
    });

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
        finalPhase: run.phase,
        findingCount: qualityFindings.length,
        artifactCount: sortedArtifacts.length
      },
      "Completed tester run."
    );

    process.stdout.write(
      `Completed tester run ${run.runId} with ${qualityFindings.length} findings and ${sortedArtifacts.length} artifacts.\n`
    );

    return {
      run,
      events: await container.runEngine.listEvents(run.runId),
      findings: qualityFindings,
      report,
      artifacts: sortedArtifacts
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
