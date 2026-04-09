import type { RunPhase, RunStatus } from "@game-bots/contracts";

import { ALLOWED_PHASE_TRANSITIONS } from "./run-phase.js";

export function canTransitionPhase(current: RunPhase, next: RunPhase): boolean {
  return ALLOWED_PHASE_TRANSITIONS[current].includes(next);
}

export function assertPhaseTransition(current: RunPhase, next: RunPhase): void {
  if (!canTransitionPhase(current, next)) {
    throw new Error(`Invalid run phase transition: ${current} -> ${next}`);
  }
}

export function deriveRunStatus(phase: RunPhase): RunStatus {
  switch (phase) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "active";
  }
}
