import type { TestScenario } from "@game-bots/game-sdk";

export const CAT_AND_DOG_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Loads the cat-and-dog desktop route, enters gameplay, and sends one gameplay input.",
  tags: ["smoke", "real-web"],
  clickProbes: [],
  actionExpectations: [
    {
      actionId: "enter-gameplay",
      description: "Smoke action should move from landing/shell to gameplay state.",
      effects: [
        {
          effectId: "gameplay-entered",
          description: "Gameplay shell markers become visible after smoke action.",
          path: "gameplayEntered",
          operator: "equals",
          expectedValue: true
        },
        {
          effectId: "gameplay-status",
          description: "Semantic status moves to gameplay.",
          path: "status",
          operator: "equals",
          expectedValue: "gameplay"
        }
      ]
    }
  ]
};
