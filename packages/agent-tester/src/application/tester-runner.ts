import type { AgentBrain, AgentContext, AgentDecision, DecisionInput, Evaluator } from "@game-bots/runtime-core";

import { ClickabilityEvaluator } from "../evaluators/clickability-evaluator.js";
import { CrashDetector } from "../evaluators/crash-detector.js";
import { FreezeDetector } from "../evaluators/freeze-detector.js";
import { UiHeuristicsEvaluator } from "../evaluators/ui-heuristics.js";

class TesterBrain implements AgentBrain {
  readonly kind = "tester" as const;
  private initialized = false;

  async initialize(_context: AgentContext): Promise<void> {
    this.initialized = true;
  }

  async decide(input: DecisionInput): Promise<AgentDecision> {
    if (!this.initialized) {
      throw new Error("Tester brain must be initialized before deciding.");
    }

    if (input.availableActions.length === 0) {
      return { type: "complete", reason: "Scenario has no more semantic actions." };
    }

    const [firstAction] = input.availableActions;
    if (!firstAction) {
      return { type: "complete", reason: "No semantic test action remained." };
    }

    return {
      type: "game-action",
      actionId: firstAction.actionId
    };
  }
}

export function createTesterBrain(): AgentBrain {
  return new TesterBrain();
}

export function createDefaultTesterEvaluators(): readonly Evaluator[] {
  return [new ClickabilityEvaluator(), new CrashDetector(), new FreezeDetector(), new UiHeuristicsEvaluator()];
}
