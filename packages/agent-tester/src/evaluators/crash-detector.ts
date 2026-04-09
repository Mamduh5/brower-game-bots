import { randomUUID } from "node:crypto";

import type { Finding, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class CrashDetector implements Evaluator {
  readonly id = "crash-detector";
  private emittedEventIds = new Set<string>();

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (event.type !== "observation.captured" || event.observationKind !== "environment-health") {
      return [];
    }

    const healthStatus = typeof event.payload.healthStatus === "string" ? event.payload.healthStatus : null;
    if ((healthStatus !== "degraded" && healthStatus !== "failed") || this.emittedEventIds.has(event.eventId)) {
      return [];
    }

    this.emittedEventIds.add(event.eventId);

    const detail =
      typeof event.payload.healthDetail === "string"
        ? event.payload.healthDetail
        : "Environment health signalled an execution problem.";
    const healthSignals = isJsonObject(event.payload.healthSignals) ? event.payload.healthSignals : null;
    const unresponsive = healthSignals?.unresponsive === true;

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: healthStatus === "failed" ? "Environment failure surfaced during tester run" : "Environment health degraded during tester run",
        summary: detail,
        severity: healthStatus === "failed" ? "critical" : "high",
        category: healthStatus === "failed" ? "crash" : unresponsive ? "freeze" : "performance",
        confidence: 0.9,
        evidence: [
          {
            eventId: event.eventId,
            label: "environment-health",
            detail
          }
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Start the tester scenario and observe the environment lifecycle."
          },
          {
            order: 2,
            instruction: "Inspect the environment health telemetry captured for the run.",
            expected: "The browser environment remains healthy while the scenario runs.",
            actual: detail
          }
        ],
        createdAt: context.clock.now().toISOString()
      }
    ];
  }

  async finalize(_context: EvaluationContext): Promise<readonly Finding[]> {
    return [];
  }
}
