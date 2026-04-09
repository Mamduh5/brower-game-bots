import { randomUUID } from "node:crypto";

import type { Finding, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

export class UiHeuristicsEvaluator implements Evaluator {
  readonly id = "ui-heuristics";

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (event.type !== "action.executed" || event.status !== "failed") {
      return [];
    }

    const targetSelector =
      typeof event.payload.targetSelector === "string" ? event.payload.targetSelector : undefined;
    const summary =
      event.summary ??
      (targetSelector
        ? `The action '${event.actionKind}' could not be completed for selector '${targetSelector}'.`
        : `The action '${event.actionKind}' could not be completed.`);

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: "UI interaction failed during tester scenario",
        summary,
        severity: "high",
        category: "ui",
        confidence: 0.92,
        evidence: [
          {
            eventId: event.eventId,
            label: "failed-action",
            detail: summary
          }
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Start the tester scenario."
          },
          {
            order: 2,
            instruction: `Attempt the '${event.actionKind}' interaction${targetSelector ? ` on '${targetSelector}'` : ""}.`
          },
          {
            order: 3,
            instruction: "Observe the action result.",
            expected: "The UI control accepts the interaction.",
            actual: summary
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
