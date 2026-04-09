import type { AgentContext, AgentDecision, DecisionInput } from "@game-bots/runtime-core";

import type { PlayerPolicy } from "../domain/player-policy.js";

export class RuleBasedPlayerPolicy implements PlayerPolicy {
  readonly kind = "player" as const;
  private initialized = false;

  async initialize(_context: AgentContext): Promise<void> {
    this.initialized = true;
  }

  async decide(input: DecisionInput): Promise<AgentDecision> {
    if (!this.initialized) {
      throw new Error("Player policy must be initialized before deciding.");
    }

    if (input.availableActions.length === 0 || input.gameState.isTerminal === true) {
      return { type: "complete", reason: "No further semantic actions are available." };
    }

    return { type: "wait", reason: "Phase 1 player policy only establishes the decision boundary." };
  }
}
