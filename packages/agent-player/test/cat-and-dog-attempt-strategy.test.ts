import { describe, expect, it } from "vitest";

import {
  selectCatAndDogAttemptStrategy,
  type CatAndDogAttemptFeedback
} from "../src/domain/cat-and-dog-attempt-strategy.js";

describe("selectCatAndDogAttemptStrategy", () => {
  it("biases away from an exact stalled strategy toward a longer-resolution variant", () => {
    const stalledAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: selectCatAndDogAttemptStrategy({
        attemptNumber: 1,
        strategyMode: "baseline"
      }).strategy,
      diagnostics: {
        semanticActionCount: 3,
        shotsFired: 0,
        waitActions: 2,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: false,
        endOverlayObserved: false,
        stepBudgetReached: true,
        turnsObserved: 0,
        shotResolutionsObserved: 0,
        directHits: 0,
        splashHits: 0,
        wallHits: 0,
        misses: 0,
        healsObserved: 0,
        damageDealt: null,
        damageTaken: null
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [stalledAttempt]
    });

    expect(next.selectionReason).toBe("stall-recovery-longer-resolution");
    expect(next.strategy.turnResolutionWaitMs).toBeGreaterThan(stalledAttempt.strategy.turnResolutionWaitMs);
    expect(next.strategy.angleDirection).toBe("right");
  });

  it("searches near a terminal loss instead of replaying the exact same candidate", () => {
    const initial = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const lossAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "LOSS",
      strategy: initial,
      diagnostics: {
        semanticActionCount: 4,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: true,
        stepBudgetReached: false,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 0,
        splashHits: 1,
        wallHits: 0,
        misses: 0,
        healsObserved: 0,
        damageDealt: 28,
        damageTaken: 100
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [lossAttempt]
    });

    expect(next.selectionReason).toBe("terminal-loss-neighbor-search");
    expect(next.strategy.turnResolutionWaitMs).not.toBe(initial.turnResolutionWaitMs);
    expect(next.strategy.powerDirection).toBe(initial.powerDirection);
  });

  it("prefers nearby variants after a non-terminal attempt that still showed damage progress", () => {
    const initial = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "explore"
    }).strategy;

    const progressAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: initial,
      diagnostics: {
        semanticActionCount: 6,
        shotsFired: 1,
        waitActions: 2,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: true,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 1,
        splashHits: 0,
        wallHits: 0,
        misses: 0,
        healsObserved: 0,
        damageDealt: 44,
        damageTaken: 12
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "explore",
      history: [progressAttempt]
    });

    expect(next.selectionReason).toBe("progress-neighbor-search");
    expect(next.strategy.angleDirection).toBe(initial.angleDirection);
  });
});
