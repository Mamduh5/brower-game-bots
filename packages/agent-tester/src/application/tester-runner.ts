import type { AgentBrain, AgentContext, AgentDecision, DecisionInput } from "@game-bots/runtime-core";

import { ScenarioExecutor } from "./scenario-executor.js";

class TesterBrain implements AgentBrain {
  readonly kind = "tester" as const;
  private readonly executor = new ScenarioExecutor();
  private initialized = false;

  async initialize(_context: AgentContext): Promise<void> {
    this.initialized = true;
  }

  async decide(input: DecisionInput): Promise<AgentDecision> {
    if (!this.initialized) {
      throw new Error("Tester brain must be initialized before deciding.");
    }

    await this.executor.execute(
      input.run.scenarioId
        ? {
            scenarioId: input.run.scenarioId,
            tags: []
          }
        : {
            tags: []
          }
    );

    if (input.availableActions.length === 0) {
      return { type: "complete", reason: "Scenario has no more semantic actions." };
    }

    return { type: "wait", reason: "Phase 1 tester establishes scenario and evaluation seams only." };
  }
}

export function createTesterBrain(): AgentBrain {
  return new TesterBrain();
}
