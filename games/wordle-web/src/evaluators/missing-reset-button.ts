import { randomUUID } from "node:crypto";

import type { Finding, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

import { WORDLE_SELECTORS } from "../selectors.js";

function domIncludesResetButton(html: string): boolean {
  return html.includes('id="reset-game"') || html.includes("id='reset-game'");
}

function domIncludesSubmittedStatus(html: string): boolean {
  return html.includes("guess-submitted");
}

export class MissingResetButtonEvaluator implements Evaluator {
  readonly id = "wordle-missing-reset-button";
  private emitted = false;

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (this.emitted || event.type !== "observation.captured") {
      return [];
    }

    const domHtml = typeof event.payload.domHtml === "string" ? event.payload.domHtml : "";
    if (!domHtml || !domIncludesSubmittedStatus(domHtml) || domIncludesResetButton(domHtml)) {
      return [];
    }

    this.emitted = true;

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: "Reset control missing after guess submission",
        summary:
          `After submitting a guess, the expected reset control '${WORDLE_SELECTORS.resetGameButton}' was not present in the UI.`,
        severity: "medium",
        category: "ui",
        confidence: 0.95,
        evidence: [
          {
            eventId: event.eventId,
            label: "post-action-dom",
            detail: "DOM observation after submitting a guess."
          }
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Open the Wordle fixture smoke scenario."
          },
          {
            order: 2,
            instruction: "Enter a guess and submit it."
          },
          {
            order: 3,
            instruction: "Inspect the UI after submission.",
            expected: "A reset control is available for another test cycle.",
            actual: "No reset control is rendered."
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
