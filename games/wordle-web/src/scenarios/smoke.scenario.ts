import type { TestScenario } from "@game-bots/game-sdk";

export const WORDLE_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Loads the game shell and validates that the board is visible.",
  tags: ["smoke", "ui"]
};
