import type { TestScenario } from "@game-bots/game-sdk";

export const CAT_AND_DOG_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Loads /play/desktop, selects 2-player mode, and validates one real in-game control input.",
  tags: ["smoke", "real-web"],
  clickProbes: [],
  actionExpectations: [
    {
      actionId: "select-two-player-mode",
      description: "Selecting 2-player from the mode menu should enter gameplay state.",
      effects: [
        {
          effectId: "gameplay-entered-from-menu",
          description: "Gameplay shell markers become visible after selecting 2-player mode.",
          path: "gameplayEntered",
          operator: "equals",
          expectedValue: true
        },
        {
          effectId: "gameplay-status-after-mode-selection",
          description: "Semantic status moves to gameplay.",
          path: "status",
          operator: "equals",
          expectedValue: "gameplay"
        },
        {
          effectId: "gameplay-hud-visible-after-mode-selection",
          description: "Gameplay HUD should be visible in gameplay mode.",
          path: "hasGameplayHud",
          operator: "equals",
          expectedValue: true
        },
        {
          effectId: "gameplay-controls-visible",
          description: "Gameplay controls hint should be visible once gameplay starts.",
          path: "hasGameplayControls",
          operator: "equals",
          expectedValue: true
        }
      ]
    },
    {
      actionId: "adjust-aim-left",
      description: "Pressing A should adjust aim left in gameplay.",
      effects: [
        {
          effectId: "aim-direction-left",
          description: "Gameplay aim status should move to left after pressing A.",
          path: "aimDirection",
          operator: "equals",
          expectedValue: "left"
        },
        {
          effectId: "gameplay-input-applied",
          description: "Semantic gameplay input marker should indicate a real control effect.",
          path: "gameplayInputApplied",
          operator: "equals",
          expectedValue: true
        }
      ]
    }
  ]
};
