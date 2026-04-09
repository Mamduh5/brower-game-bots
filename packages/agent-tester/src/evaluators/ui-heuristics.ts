import type { Finding, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

export class UiHeuristicsEvaluator implements Evaluator {
  readonly id = "ui-heuristics";

  async onEvent(_event: RunEvent, _context: EvaluationContext): Promise<readonly Finding[]> {
    return [];
  }

  async finalize(_context: EvaluationContext): Promise<readonly Finding[]> {
    return [];
  }
}
