import { randomUUID } from "node:crypto";

import type { Finding, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

function toSnapshotFingerprint(event: RunEvent): string | null {
  if (event.type !== "observation.captured") {
    return null;
  }

  const semanticState = event.payload.gameSemanticState;
  if (!semanticState || typeof semanticState !== "object" || Array.isArray(semanticState)) {
    return null;
  }

  return JSON.stringify({
    title: typeof event.payload.gameSnapshotTitle === "string" ? event.payload.gameSnapshotTitle : "unknown",
    isTerminal: event.payload.gameSnapshotTerminal === true,
    semanticState
  });
}

export class FreezeDetector implements Evaluator {
  readonly id = "freeze-detector";
  private openingFingerprint: string | null = null;
  private lastActionEventId: string | null = null;
  private sawSuccessfulAction = false;
  private emitted = false;

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (event.type === "observation.captured" && event.observationKind === "state-expectation") {
      return [];
    }

    if (event.type === "action.executed" && event.status === "succeeded") {
      this.sawSuccessfulAction = true;
      this.lastActionEventId = event.eventId;
      return [];
    }

    if (event.type !== "observation.captured") {
      return [];
    }

    const fingerprint = toSnapshotFingerprint(event);
    if (!fingerprint) {
      return [];
    }

    if (event.observationKind === "opening") {
      this.openingFingerprint = fingerprint;
      return [];
    }

    if (
      this.emitted ||
      event.observationKind !== "post-action" ||
      !this.sawSuccessfulAction ||
      !this.openingFingerprint ||
      fingerprint !== this.openingFingerprint
    ) {
      return [];
    }

    this.emitted = true;

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: "Successful action did not change semantic state",
        summary:
          "The tester executed a successful action, but the semantic game snapshot remained unchanged between the opening and post-action observations.",
        severity: "medium",
        category: "functional",
        confidence: 0.88,
        evidence: [
          {
            eventId: event.eventId,
            label: "post-action-state",
            detail: "Semantic snapshot after the action matched the opening state."
          },
          ...(this.lastActionEventId
            ? [
                {
                  eventId: this.lastActionEventId,
                  label: "successful-action",
                  detail: "The preceding action was reported as succeeded."
                }
              ]
            : [])
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Start the tester scenario and wait for the opening observation."
          },
          {
            order: 2,
            instruction: "Execute the planned action for the scenario."
          },
          {
            order: 3,
            instruction: "Compare semantic state before and after the action.",
            expected: "The semantic game state changes after a successful interaction.",
            actual: "The semantic game state stayed identical after the action."
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
