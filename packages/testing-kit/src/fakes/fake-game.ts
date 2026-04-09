import type { EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type {
  GameActionRequest,
  GameActionSpec,
  GamePlugin,
  GameSession,
  GameSessionContext,
  GameSnapshot,
  TestScenario
} from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

class FakeGameSession implements GameSession {
  async bootstrap(_environment: EnvironmentSession): Promise<void> {
    return Promise.resolve();
  }

  async translate(_frame: ObservationFrame): Promise<GameSnapshot> {
    return {
      title: "Fake Game",
      isTerminal: false,
      semanticState: {
        phase: "ready"
      },
      metrics: {}
    };
  }

  async actions(): Promise<readonly GameActionSpec[]> {
    return [{ actionId: "noop", description: "No operation" }];
  }

  async resolveAction(_action: GameActionRequest): Promise<readonly { kind: "wait"; durationMs: number }[]> {
    return [{ kind: "wait", durationMs: 1 }];
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [
      {
        scenarioId: "smoke",
        description: "Basic smoke scenario",
        tags: ["smoke"],
        clickProbes: [],
        actionExpectations: []
      }
    ];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [];
  }
}

export class FakeGamePlugin implements GamePlugin {
  readonly manifest = {
    gameId: "fake-game",
    displayName: "Fake Game",
    version: "0.1.0"
  };

  async createSession(_context: GameSessionContext): Promise<GameSession> {
    return new FakeGameSession();
  }
}
