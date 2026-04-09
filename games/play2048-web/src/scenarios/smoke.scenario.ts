import type { TestScenario } from "@game-bots/game-sdk";

import { PLAY2048_SELECTORS } from "../selectors.js";

export const PLAY2048_SMOKE_SCENARIO: TestScenario = {
  scenarioId: "smoke",
  description: "Load the real 2048 web game and validate baseline interactivity.",
  tags: ["smoke", "real-web"],
  clickProbes: [
    {
      probeId: "restart-hitbox",
      description: "Validate that the restart control remains clickable across its visible surface.",
      surfaceSelector: PLAY2048_SELECTORS.restartButton,
      activationSelector: PLAY2048_SELECTORS.restartButton,
      minimumSuccessRatio: 0.7
    }
  ],
  actionExpectations: []
};
