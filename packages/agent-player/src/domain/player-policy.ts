import type { AgentBrain } from "@game-bots/runtime-core";

export interface PlayerPolicy extends AgentBrain {
  readonly kind: "player";
}
