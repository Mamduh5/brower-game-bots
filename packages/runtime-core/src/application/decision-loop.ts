import type { AgentBrain, AgentDecision, DecisionInput } from "../ports/agent-brain.js";

export class DecisionLoop {
  async next(brain: AgentBrain, input: DecisionInput): Promise<AgentDecision> {
    return brain.decide(input);
  }
}
