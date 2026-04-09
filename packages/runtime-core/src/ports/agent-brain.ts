import type { AgentKind, JsonObject, RunEvent, RunRecord } from "@game-bots/contracts";

export interface AvailableAction {
  actionId: string;
  description: string;
}

export interface DecisionInput {
  run: RunRecord;
  gameState: JsonObject;
  availableActions: readonly AvailableAction[];
  recentEvents: readonly RunEvent[];
}

export type AgentDecision =
  | { type: "game-action"; actionId: string; params?: JsonObject }
  | { type: "wait"; reason: string }
  | { type: "complete"; reason: string }
  | { type: "abort"; reason: string };

export interface AgentContext {
  run: RunRecord;
}

export interface AgentBrain {
  readonly kind: AgentKind;
  initialize(context: AgentContext): Promise<void>;
  decide(input: DecisionInput): Promise<AgentDecision>;
  shutdown?(): Promise<void>;
}
