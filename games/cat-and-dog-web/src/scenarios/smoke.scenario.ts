import type { TestScenario } from "@game-bots/game-sdk";

export const CAT_AND_DOG_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Loads the cat-and-dog web game and sends one interaction pulse.",
  tags: ["smoke", "real-web"],
  clickProbes: [],
  actionExpectations: []
};
