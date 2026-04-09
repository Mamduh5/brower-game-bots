import type { RunPhase, RunRecord } from "@game-bots/contracts";

import { assertPhaseTransition, deriveRunStatus } from "../domain/run-state.js";

export class RunLifecycle {
  transition(run: RunRecord, nextPhase: RunPhase, now: Date): RunRecord {
    assertPhaseTransition(run.phase, nextPhase);

    return {
      ...run,
      phase: nextPhase,
      status: deriveRunStatus(nextPhase),
      updatedAt: now.toISOString()
    };
  }
}
