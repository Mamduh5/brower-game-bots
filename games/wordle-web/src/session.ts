import type { EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type { GameActionSpec, GameSession, GameSnapshot, TestScenario } from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import { buildSubmitGuessAction } from "./actions/submit-guess.js";
import { WORDLE_SMOKE_SCENARIO } from "./scenarios/smoke.scenario.js";
import { parseBoard } from "./snapshot/parse-board.js";

export class WordleGameSession implements GameSession {
  async bootstrap(_environment: EnvironmentSession): Promise<void> {
    return Promise.resolve();
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const board = parseBoard(frame);

    return {
      title: "Wordle",
      isTerminal: false,
      semanticState: {
        boardRows: [...board.rows]
      },
      metrics: {}
    };
  }

  async actions(_snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    return [buildSubmitGuessAction({ guess: "adieu" })];
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [WORDLE_SMOKE_SCENARIO];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [];
  }
}
