import type { Finding, RunEvent, RunRecord } from "@game-bots/contracts";

import type { Clock } from "./clock.js";

export interface EvaluationContext {
  run: RunRecord;
  clock: Clock;
}

export interface Evaluator {
  readonly id: string;
  onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]>;
  finalize(context: EvaluationContext): Promise<readonly Finding[]>;
}
