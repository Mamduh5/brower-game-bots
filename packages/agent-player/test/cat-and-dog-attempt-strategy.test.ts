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
        lastVisionShotOutcomeLabel: "none",
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

  it("uses target-side visual feedback to replay the strongest local region intentionally", () => {
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
        lastVisionShotOutcomeLabel: "target-side-impact",
        damageDealt: 28,
        damageTaken: 100
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [lossAttempt]
    });

    expect(next.selectionReason).toBe("visual-correction-target-side-impact");
    expect(next.strategy.turnResolutionWaitMs).toBe(initial.turnResolutionWaitMs);
    expect(next.strategy.powerDirection).toBe(initial.powerDirection);
    expect(next.selectionDetails.topReferenceAttemptNumber).toBe(1);
    expect(next.selectionDetails.topReferenceDistance).toBe(0);
    expect(next.selectionDetails.selectionMode).toBe("exact-replay");
    expect(next.selectionDetails.changedKnob).toBe("none");
    expect(next.selectionDetails.triggeredByVisualOutcomeLabel).toBe("target-side-impact");
    expect(next.selectionDetails.rankedRecentAttempts[0]?.attemptNumber).toBe(1);
  });

  it("uses near-target visual feedback to stay in the same promising local region", () => {
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
        lastVisionShotOutcomeLabel: "near-target",
        damageDealt: 44,
        damageTaken: 12
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "explore",
      history: [progressAttempt]
    });

    expect(next.selectionReason).toBe("visual-correction-near-target");
    expect(next.strategy.angleDirection).toBe(initial.angleDirection);
    expect(["exact-replay", "one-knob-mutation"]).toContain(next.selectionDetails.selectionMode);
    expect(next.selectionDetails.triggeredByVisualOutcomeLabel).toBe("near-target");
    expect(next.selectionDetails.topReferenceScore).toBeGreaterThan(300);
  });

  it("nudges power upward after a visually short shot instead of replaying the same shot unchanged", () => {
    const initial = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const shortAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: initial,
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
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
        visionShortShots: 1,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        lastVisionShotOutcomeLabel: "short",
        damageDealt: 18,
        damageTaken: 10
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [shortAttempt]
    });

    expect(next.selectionReason).toBe("visual-correction-short");
    expect(next.selectionDetails.selectionMode).toBe("one-knob-mutation");
    expect(next.selectionDetails.changedKnob).toBe("powerTapCount");
    expect(next.selectionDetails.triggeredByVisualOutcomeLabel).toBe("short");
    expect(next.strategy.powerTapCount).toBeGreaterThan(initial.powerTapCount);
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
        lastVisionShotOutcomeLabel: "blocked",
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

  it("switches to a visually guided one-knob local mutation after repeated local failures around the same anchor attempt", () => {
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
        lastVisionShotOutcomeLabel: "target-side-impact",
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
        lastVisionShotOutcomeLabel: "blocked",
        damageDealt: 0,
        damageTaken: 18
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 3,
      strategyMode: "baseline",
      history: [anchorLoss, repeatedLocalUnknown]
    });

    expect(next.selectionReason).toBe("visual-correction-blocked");
    expect(next.selectionDetails.selectionMode).toBe("one-knob-mutation");
    expect(next.selectionDetails.topReferenceAttemptNumber).toBe(1);
    expect(next.selectionDetails.changedKnob).toBe("angleTapCount");
    expect(next.selectionDetails.triggeredByVisualOutcomeLabel).toBe("blocked");
    expect(next.selectionDetails.topReferenceDistance).toBe(2);
  });

  it("keeps using the latest meaningful local visual label even if the most recent nearby attempt had no useful visual trigger", () => {
    const anchor = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const meaningfulAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: anchor,
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
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
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 1,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        lastVisionShotOutcomeLabel: "blocked",
        damageDealt: 12,
        damageTaken: 8
      }
    };

    const weakerNearbyAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 2,
      outcome: "UNKNOWN",
      strategy: {
        ...anchor,
        attemptNumber: 2,
        angleTapCount: Math.min(anchor.angleTapCount + 1, 5)
      },
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: true,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 0,
        splashHits: 1,
        wallHits: 0,
        misses: 0,
        healsObserved: 0,
        visionChangeSignals: 0,
        visionStrongChangeSignals: 0,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 1,
        visionNearTargetShots: 0,
        visionBlockedShots: 0,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        lastVisionShotOutcomeLabel: "none",
        damageDealt: 0,
        damageTaken: 18
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 3,
      strategyMode: "baseline",
      history: [meaningfulAttempt, weakerNearbyAttempt]
    });

    expect(next.selectionReason).toBe("visual-correction-blocked");
    expect(next.selectionDetails.triggeredByVisualOutcomeLabel).toBe("blocked");
    expect(next.selectionDetails.changedKnob).toBe("angleTapCount");
  });

  it("uses wind plus projectile context to make a larger short-shot power correction when the current projectile is wind-sensitive", () => {
    const initial = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "explore"
    }).strategy;

    const shortInHeadwind: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: {
        ...initial,
        weaponKey: "light",
        angleDirection: "right",
        powerTapCount: 2
      },
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: false,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 0,
        splashHits: 0,
        wallHits: 0,
        misses: 1,
        healsObserved: 0,
        visionChangeSignals: 1,
        visionStrongChangeSignals: 1,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 0,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 0,
        visionShortShots: 1,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        lastVisionShotOutcomeLabel: "short",
        damageDealt: 18,
        damageTaken: 12,
        runtimeStateAvailable: true,
        windValue: -120,
        windNormalized: -0.85,
        windDirection: "left",
        projectileLabel: "Light",
        projectileWeight: 0.66,
        projectileLaunchSpeedMultiplier: 1.08,
        projectileGravityMultiplier: 0.84,
        projectileWindInfluenceMultiplier: 2.1,
        projectileSplashRadius: 32,
        projectileDamageMin: 3,
        projectileDamageMax: 8,
        projectileWindupSeconds: 0.12,
        preparedShotAngle: 48,
        preparedShotPower: 520,
        preparedShotKey: "light"
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "explore",
      history: [shortInHeadwind]
    });

    expect(next.selectionReason).toBe("runtime-shot-planner");
    expect(next.selectionDetails.plannerMode).toBe("runtime-shot-planner");
    expect(next.selectionDetails.plannerInputs?.windDirection).toBe("left");
    expect(next.selectionDetails.plannerInputs?.projectileWindInfluenceMultiplier).toBe(2.1);
    expect(next.selectionDetails.plannerIntent?.powerTapCount).toBe(next.strategy.powerTapCount);
    expect(next.selectionDetails.triggeredByVisualOutcomeLabel).toBe("short");
    expect(["powerTapCount", "angleTapCount", "weaponKey"]).toContain(next.selectionDetails.changedKnob);
    expect(next.selectionDetails.plannerFamily).toBe("high-arc-anti-headwind");
    expect(next.selectionDetails.plannerCategory).toBe("default-runtime");
    expect(next.strategy.powerTapCount).toBeGreaterThanOrEqual(shortInHeadwind.strategy.powerTapCount + 2);
    expect(next.selectionDetails.plannerReason?.toLowerCase()).toContain("headwind");
    expect(next.strategy.weaponKey).toBe("normal");
  });

  it("changes the planned shot when the same recent visual outcome is paired with opposite wind context", () => {
    const base = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const headwindFeedback: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: {
        ...base,
        angleDirection: "right",
        powerTapCount: 2
      },
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
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
        visionShortShots: 1,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        lastVisionShotOutcomeLabel: "short",
        damageDealt: 16,
        damageTaken: 12,
        runtimeStateAvailable: true,
        windValue: -90,
        windNormalized: -0.72,
        windDirection: "left",
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1,
        projectileGravityMultiplier: 1,
        projectileWindInfluenceMultiplier: 1.8,
        projectileSplashRadius: 18,
        projectileDamageMin: 8,
        projectileDamageMax: 14,
        projectileWindupSeconds: 0.18,
        preparedShotAngle: 40,
        preparedShotPower: 460,
        preparedShotKey: "normal"
      }
    };

    const tailwindFeedback: CatAndDogAttemptFeedback = {
      ...headwindFeedback,
      attemptNumber: 2,
      diagnostics: {
        ...headwindFeedback.diagnostics,
        windValue: 90,
        windNormalized: 0.72,
        windDirection: "right"
      }
    };

    const headwindPlan = selectCatAndDogAttemptStrategy({
      attemptNumber: 3,
      strategyMode: "baseline",
      history: [headwindFeedback]
    });
    const tailwindPlan = selectCatAndDogAttemptStrategy({
      attemptNumber: 3,
      strategyMode: "baseline",
      history: [tailwindFeedback]
    });

    expect(headwindPlan.selectionDetails.plannerMode).toBe("runtime-shot-planner");
    expect(tailwindPlan.selectionDetails.plannerMode).toBe("runtime-shot-planner");
    expect(headwindPlan.selectionDetails.plannerFamily).toBe("high-arc-anti-headwind");
    expect(tailwindPlan.selectionDetails.plannerFamily).toBe("flatter-tailwind-trim");
    expect(headwindPlan.strategy.powerTapCount).toBeGreaterThan(tailwindPlan.strategy.powerTapCount);
    expect(headwindPlan.selectionDetails.plannerReason).not.toBe(tailwindPlan.selectionDetails.plannerReason);
  });

  it("switches away from a repeatedly failing self-side recovery family instead of replaying it again", () => {
    const base = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const firstRecovery: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: {
        ...base,
        angleDirection: "right",
        angleTapCount: 4,
        powerTapCount: 4
      },
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: true,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 0,
        splashHits: 0,
        wallHits: 0,
        misses: 1,
        healsObserved: 0,
        visionChangeSignals: 1,
        visionStrongChangeSignals: 1,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 1,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 0,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 1,
        lastVisionShotOutcomeLabel: "self-side-impact",
        damageDealt: 0,
        damageTaken: 18,
        runtimeStateAvailable: true,
        windValue: 20,
        windNormalized: 0.12,
        windDirection: "right",
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1,
        projectileGravityMultiplier: 1,
        projectileWindInfluenceMultiplier: 1.1,
        projectileSplashRadius: 22,
        projectileDamageMin: 7,
        projectileDamageMax: 12,
        projectileWindupSeconds: 0.18,
        preparedShotAngle: 52,
        preparedShotPower: 620,
        preparedShotKey: "normal"
      },
      planner: {
        family: "self-side-recovery",
        category: "recovery",
        switchReason: null
      }
    };

    const secondRecovery: CatAndDogAttemptFeedback = {
      ...firstRecovery,
      attemptNumber: 2,
      strategy: {
        ...firstRecovery.strategy,
        attemptNumber: 2
      },
      diagnostics: {
        ...firstRecovery.diagnostics,
        damageTaken: 20
      },
      planner: {
        family: "self-side-recovery",
        category: "recovery",
        switchReason: null
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 3,
      strategyMode: "baseline",
      history: [firstRecovery, secondRecovery]
    });

    expect(next.selectionReason).toBe("runtime-shot-planner");
    expect(next.selectionDetails.plannerFamily).toBe("medium-arc-default");
    expect(next.selectionDetails.plannerCategory).toBe("default-runtime");
    expect(next.selectionDetails.plannerFamilySwitchReason).toContain("Repeated self-side recovery");
  });

  it("uses a blocked-terrain escape family and can upgrade to heavy when splash makes that family safer", () => {
    const base = selectCatAndDogAttemptStrategy({
      attemptNumber: 1,
      strategyMode: "baseline"
    }).strategy;

    const blockedAttempt: CatAndDogAttemptFeedback = {
      attemptNumber: 1,
      outcome: "UNKNOWN",
      strategy: {
        ...base,
        weaponKey: "normal",
        angleDirection: "right",
        angleTapCount: 2,
        powerTapCount: 3
      },
      diagnostics: {
        semanticActionCount: 5,
        shotsFired: 1,
        waitActions: 1,
        gameplayEnteredObserved: true,
        playerTurnReadyObserved: true,
        endOverlayObserved: false,
        stepBudgetReached: false,
        turnsObserved: 1,
        shotResolutionsObserved: 1,
        directHits: 0,
        splashHits: 0,
        wallHits: 1,
        misses: 0,
        healsObserved: 0,
        visionChangeSignals: 1,
        visionStrongChangeSignals: 0,
        visionTargetSideSignals: 0,
        visionTerrainSideSignals: 1,
        visionNoChangeShots: 0,
        visionNearTargetShots: 0,
        visionBlockedShots: 1,
        visionShortShots: 0,
        visionLongShots: 0,
        visionSelfSideShots: 0,
        lastVisionShotOutcomeLabel: "blocked",
        damageDealt: 0,
        damageTaken: 10,
        runtimeStateAvailable: true,
        windValue: 18,
        windNormalized: 0.08,
        windDirection: "right",
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1,
        projectileGravityMultiplier: 1,
        projectileWindInfluenceMultiplier: 1.05,
        projectileSplashRadius: 72,
        projectileDamageMin: 10,
        projectileDamageMax: 24,
        projectileWindupSeconds: 0.22,
        preparedShotAngle: 44,
        preparedShotPower: 560,
        preparedShotKey: "normal"
      }
    };

    const next = selectCatAndDogAttemptStrategy({
      attemptNumber: 2,
      strategyMode: "baseline",
      history: [blockedAttempt]
    });

    expect(next.selectionReason).toBe("runtime-shot-planner");
    expect(next.selectionDetails.plannerFamily).toBe("blocked-terrain-escape");
    expect(next.selectionDetails.plannerCategory).toBe("blocked-escape");
    expect(next.strategy.weaponKey).toBe("heavy");
    expect(next.selectionDetails.changedKnob).toBe("weaponKey");
  });
});
