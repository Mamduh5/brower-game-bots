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
        visionChangeSignals: 0,
        visionStrongChangeSignals: 0,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 0,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
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
        visionChangeSignals: 1,
        visionStrongChangeSignals: 1,
        visionTargetSideSignals: 1,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 0,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        damageDealt: 28,
        damageTaken: 100
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [lossAttempt]
    });

    expect(next.selectionReason).toBe("anchor-exact-replay");
    expect(next.strategy.turnResolutionWaitMs).toBe(initial.turnResolutionWaitMs);
    expect(next.strategy.powerDirection).toBe(initial.powerDirection);
    expect(next.selectionDetails.topReferenceAttemptNumber).toBe(1);
    expect(next.selectionDetails.topReferenceDistance).toBe(0);
    expect(next.selectionDetails.selectionMode).toBe("exact-replay");
    expect(next.selectionDetails.changedKnob).toBe("none");
    expect(next.selectionDetails.rankedRecentAttempts[0]?.attemptNumber).toBe(1);
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
        visionChangeSignals: 1,
        visionStrongChangeSignals: 1,
        visionTargetSideSignals: 1,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 0,
        visionNearTargetShots: 1,
        visionBlockedShots: 0,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        damageDealt: 44,
        damageTaken: 12
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "explore",
      history: [progressAttempt]
    });

    expect(next.selectionReason).toBe("anchor-exact-replay");
    expect(next.strategy.angleDirection).toBe(initial.angleDirection);
    expect(next.selectionDetails.selectionMode).toBe("exact-replay");
    expect(next.selectionDetails.topReferenceScore).toBeGreaterThan(300);
  });

  it("avoids returning to a clearly weak repeated variant when history already shows it underperforming", () => {
    const initial = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const weakAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: initial,
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 2,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: true,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 0,
        splashHits: 0,
        wallHits: 1,
        misses: 0,
        healsObserved: 0,
        visionChangeSignals: 0,
        visionStrongChangeSignals: 0,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 1,
        visionNoChangeShots: 1,
        visionNearTargetShots: 0,
        visionBlockedShots: 1,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        damageDealt: 0,
        damageTaken: 18
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [weakAttempt]
    });

    expect(next.selectionReason).toBe("avoid-weaker-repeat");
    expect(next.selectionDetails.selectedFingerprint).not.toBe(next.selectionDetails.rankedRecentAttempts[0]?.fingerprint);
  });

  it("switches to a one-knob local mutation after repeated local failures around the same anchor attempt", () => {
    const anchor = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const anchorLoss: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "LOSS",
      strategy: anchor,
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
        visionChangeSignals: 1,
        visionStrongChangeSignals: 0,
        visionTargetSideSignals: 1,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 0,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        damageDealt: 28,
        damageTaken: 100
      }
    };

    const repeatedLocalUnknown: CatAndDogAttemptFeedback = {
      attemptNumber: 2,
      outcome: "UNKNOWN",
      strategy: {
        ...anchor,
        attemptNumber: 2
      },
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 2,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: true,
        turnsObserved: 1,
        shotResolutionsObserved: 0,
        directHits: 0,
        splashHits: 0,
        wallHits: 1,
        misses: 0,
        healsObserved: 0,
        visionChangeSignals: 0,
        visionStrongChangeSignals: 0,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 1,
        visionNoChangeShots: 1,
        visionNearTargetShots: 0,
        visionBlockedShots: 1,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        damageDealt: 0,
        damageTaken: 18
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 3,
      strategyMode: "baseline",
      history: [anchorLoss, repeatedLocalUnknown]
    });

    expect(next.selectionReason.startsWith("anchor-one-knob-")).toBe(true);
    expect(next.selectionDetails.selectionMode).toBe("one-knob-mutation");
    expect(next.selectionDetails.topReferenceAttemptNumber).toBe(1);
    expect(next.selectionDetails.changedKnob).not.toBe("none");
    expect(next.selectionDetails.topReferenceDistance).toBe(1);
  });
});
