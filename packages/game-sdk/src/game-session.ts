import type { EnvironmentAction, EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import type { GameActionRequest, GameActionSpec } from "./game-action.js";
import type { GameSnapshot } from "./game-snapshot.js";
import type { TestScenario } from "./test-scenario.js";

export interface GameSession {
  bootstrap(environment: EnvironmentSession): Promise<void>;
  translate(frame: ObservationFrame): Promise<GameSnapshot>;
  actions(snapshot: GameSnapshot): Promise<readonly GameActionSpec[]>;
  resolveAction(action: GameActionRequest, snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]>;
  scenarios(): Promise<readonly TestScenario[]>;
  evaluators(): Promise<readonly Evaluator[]>;
}
