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
  ]
};
