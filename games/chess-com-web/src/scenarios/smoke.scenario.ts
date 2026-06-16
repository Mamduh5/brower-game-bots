import type { TestScenario } from "@game-bots/game-sdk";

export const CHESS_COM_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Open Chess.com computer play and verify the board can be observed without entering human matchmaking.",
  tags: ["smoke", "computer-only"],
  clickProbes: [],
  actionExpectations: []
};
