import type { RunPhase } from "@game-bots/contracts";

export const ALLOWED_PHASE_TRANSITIONS: Record<RunPhase, readonly RunPhase[]> = {
  created: ["preparing", "cancelled"],
  preparing: ["environment_starting", "failed", "cancelled"],
  environment_starting: ["game_bootstrap", "failed", "cancelled"],
  game_bootstrap: ["executing", "failed", "cancelled"],
  executing: ["evaluating", "failed", "cancelled"],
  evaluating: ["reporting", "failed", "cancelled"],
  reporting: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
};
