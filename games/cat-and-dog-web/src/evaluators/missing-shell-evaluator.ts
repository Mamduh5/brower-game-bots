import { randomUUID } from "node:crypto";

import type { Finding, JsonObject, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

export class MissingShellEvaluator implements Evaluator {
  readonly id = "cat-and-dog-missing-shell";
  private evaluatedOpening = false;

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (this.evaluatedOpening || event.type !== "observation.captured" || event.observationKind !== "opening") {
      return [];
    }

    this.evaluatedOpening = true;

    const semanticState = (event.payload.gameSemanticState ?? {}) as JsonObject;
    const hasAppRoot = semanticState.hasAppRoot === true;
    const hasPlayableSurface = semanticState.hasPlayableSurface === true;
    const status = semanticState.status;

    if (hasAppRoot || hasPlayableSurface || status === "ready") {
      return [];
    }

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: "Cat-and-dog shell was not detected on opening observation",
        summary:
          "The smoke run reached the route, but expected shell markers were missing (no app root and no playable surface were detected).",
        severity: "medium",
        category: "functional",
        confidence: 0.82,
        evidence: [
          {
            eventId: event.eventId,
            label: "opening-observation",
            detail: "Opening semantic snapshot reported loading state without shell markers."
          }
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Open https://cat-and-dog-p6qd.onrender.com/."
          },
          {
            order: 2,
            instruction: "Observe initial rendered shell.",
            expected: "A root app shell or playable surface is present.",
            actual: "No expected shell markers were detected."
          }
        ],
        metadata: {
          shell: {
            hasAppRoot,
            hasPlayableSurface,
            status: typeof status === "string" ? status : "unknown"
          }
        },
        createdAt: context.clock.now().toISOString()
      }
    ];
  }

  async finalize(_context: EvaluationContext): Promise<readonly Finding[]> {
    return [];
  }
}
