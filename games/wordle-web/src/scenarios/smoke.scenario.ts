import type { TestScenario } from "@game-bots/game-sdk";

import { WORDLE_SELECTORS } from "../selectors.js";

export const WORDLE_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Loads the game shell and validates that the board is visible.",
  tags: ["smoke", "ui"],
  clickProbes: [
    {
      probeId: "help-probe-hitbox",
      description: "Validate that the visible help control is clickable across its apparent bounds.",
      surfaceSelector: WORDLE_SELECTORS.helpProbeShell,
      activationSelector: WORDLE_SELECTORS.helpProbeTrigger,
      minimumSuccessRatio: 0.5
    }
  ],
  actionExpectations: [
    {
      actionId: "submit-guess",
      description: "Submitting a guess should update the semantic board state and lock the submit control.",
      effects: [
        {
          effectId: "status-updates",
          description: "Game status changes to guess-submitted after a successful submit.",
          path: "status",
          operator: "equals",
          expectedValue: "guess-submitted"
        },
        {
          effectId: "first-row-filled",
          description: "The first board row contains the submitted guess.",
          path: "boardRows.0",
          operator: "equals",
          expectedValue: "ADIEU"
        },
        {
          effectId: "submit-locks",
          description: "The submit control becomes disabled after the guess is submitted.",
          path: "submitDisabled",
          operator: "equals",
          expectedValue: true
        }
      ]
    }
  ]
};
