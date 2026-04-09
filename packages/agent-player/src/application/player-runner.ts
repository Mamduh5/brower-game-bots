import type { AgentBrain } from "@game-bots/runtime-core";

import { RuleBasedPlayerPolicy } from "../policies/rule-based-policy.js";

export function createPlayerBrain(): AgentBrain {
  return new RuleBasedPlayerPolicy();
}
