import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import type { EnvironmentAction, EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type {
  GameActionRequest,
  GameActionSpec,
  GameSession,
  GameSnapshot,
  TestScenario
} from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import { buildSubmitGuessAction } from "./actions/submit-guess.js";
import { MissingResetButtonEvaluator } from "./evaluators/missing-reset-button.js";
import { WORDLE_SMOKE_SCENARIO } from "./scenarios/smoke.scenario.js";
import { WORDLE_SELECTORS } from "./selectors.js";
import { parseBoard } from "./snapshot/parse-board.js";

export class WordleGameSession implements GameSession {
  async bootstrap(environment: EnvironmentSession): Promise<void> {
    const fixturePath = fileURLToPath(new URL("../fixtures/wordle-fixture.html", import.meta.url));
    const fixtureUrl = pathToFileURL(path.resolve(fixturePath)).toString();

    await environment.execute({
      kind: "navigate",
      url: fixtureUrl
    });
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const board = parseBoard(frame);
    const isSubmitted = board.status === "guess-submitted";

    return {
      title: "Wordle",
      isTerminal: isSubmitted,
      semanticState: {
        status: board.status,
        boardRows: [...board.rows],
        inputDisabled: board.inputDisabled,
        submitDisabled: board.submitDisabled
      },
      metrics: {
        rowCount: board.rows.length
      }
    };
  }

  async actions(snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    if (snapshot.isTerminal) {
      return [];
    }

    return [buildSubmitGuessAction({ guess: "adieu" })];
  }

  async resolveAction(action: GameActionRequest, _snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    if (action.actionId !== "submit-guess") {
      throw new Error(`Unsupported Wordle action: ${action.actionId}`);
    }

    const guess = typeof action.params?.guess === "string" ? action.params.guess : "adieu";

    return [
      {
        kind: "type",
        target: {
          selector: WORDLE_SELECTORS.guessInput
        },
        text: guess
      },
      {
        kind: "click",
        target: {
          selector: WORDLE_SELECTORS.submitGuessButton
        }
      }
    ];
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [WORDLE_SMOKE_SCENARIO];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [new MissingResetButtonEvaluator()];
  }
}
