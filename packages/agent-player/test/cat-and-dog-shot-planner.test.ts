import { describe, expect, it } from "vitest";

import type {
  CatAndDogAttemptStrategy,
  CatAndDogStrategySelectionDetails
} from "../src/domain/cat-and-dog-attempt-strategy.js";
import {
  planCatAndDogShotExecution,
  type CatAndDogShotFeedbackRecord
} from "../src/domain/cat-and-dog-shot-planner.js";

function buildBaseStrategy(): CatAndDogAttemptStrategy {
  return {
    attemptNumber: 2,
    strategyMode: "baseline",
    difficulty: "easy",
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 180,
    turnResolutionWaitMs: 2200
  };
}

function buildSelectionDetails(
  overrides: Partial<CatAndDogStrategySelectionDetails> = {}
): CatAndDogStrategySelectionDetails {
  return {
    selectedFingerprint: "normal:right:2:up:3:180:2200",
    exactUseCount: 0,
    topReferenceAttemptNumber: 1,
    topReferenceScore: 320,
    topReferenceDistance: 0,
    selectionMode: "runtime-planned",
    changedKnob: "angleTapCount",
    triggeredByVisualOutcomeLabel: "short",
    plannerMode: "runtime-shot-planner",
    plannerFamily: "medium-arc-default",
    plannerCategory: "default-runtime",
    plannerFamilySwitchReason: null,
    plannerReason: "seeded planner",
    plannerInputs: null,
    plannerIntent: null,
    expectedMutationReason: null,
    rankedRecentAttempts: [],
    ...overrides
  };
}

function buildShotFeedback(
  overrides: Partial<CatAndDogShotFeedbackRecord> = {}
): CatAndDogShotFeedbackRecord {
  return {
    shotNumber: 1,
    family: "medium-arc-default",
    category: "default-runtime",
    fingerprint: "normal:right:2:up:3:180:2200",
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 3,
    visualOutcomeLabel: "short",
    shotResolutionCategory: "miss",
    hintCategory: "combat-result",
    hintText: "Shot fell short.",
    damageDealtDelta: 0,
    damageTakenDelta: 0,
    shotResolved: true,
    playerTurnReadyAfter: true,
    turnCounterAfter: 2,
    outcomeAfterShot: null,
    meaningfulProgress: false,
    familyFailed: true,
    ...overrides
  };
}

describe("planCatAndDogShotExecution", () => {
  it("chooses a higher-arc family under strong headwind even before shot history exists", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: buildBaseStrategy(),
      selectionDetails: buildSelectionDetails({
        plannerFamily: null,
        plannerCategory: null
      }),
      runtime: {
        windDirection: "left",
        windNormalized: -0.72,
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
        preparedShotKey: "light",
        selectedWeaponKey: "light"
      },
      shotHistory: []
    });

    expect(plan.family).toBe("high-arc-anti-headwind");
    expect(plan.strategy.powerTapCount).toBeGreaterThanOrEqual(4);
    expect(plan.strategy.weaponKey).toBe("normal");
    expect(plan.inputsUsed).toContain("wind");
    expect(plan.inputsUsed).toContain("projectile-physics");
  });

  it("abandons a repeatedly failing self-side family instead of replaying it again", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: buildBaseStrategy(),
      selectionDetails: buildSelectionDetails({
        plannerFamily: "self-side-recovery",
        plannerCategory: "recovery"
      }),
      runtime: {
        windDirection: "calm",
        windNormalized: 0,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1,
        projectileGravityMultiplier: 1,
        projectileWindInfluenceMultiplier: 1,
        projectileSplashRadius: 24,
        projectileDamageMin: 8,
        projectileDamageMax: 14,
        projectileWindupSeconds: 0.18,
        preparedShotAngle: 60,
        preparedShotPower: 700,
        preparedShotKey: "normal",
        selectedWeaponKey: "normal"
      },
      shotHistory: [
        buildShotFeedback({
          family: "self-side-recovery",
          category: "recovery",
          visualOutcomeLabel: "self-side-impact",
          fingerprint: "normal:right:4:up:4:220:2400"
        }),
        buildShotFeedback({
          shotNumber: 2,
          family: "self-side-recovery",
          category: "recovery",
          visualOutcomeLabel: "self-side-impact",
          fingerprint: "normal:right:5:up:4:220:2400"
        })
      ]
    });

    expect(plan.family).toBe("medium-arc-default");
    expect(plan.familySwitchReason).toContain("Repeated self-side recovery");
    expect(plan.source).toBe("family-abandonment");
  });

  it("uses heavy conservatively for blocked-terrain escape when splash context justifies it", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: buildBaseStrategy(),
      selectionDetails: buildSelectionDetails(),
      runtime: {
        windDirection: "right",
        windNormalized: 0.08,
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
        preparedShotKey: "normal",
        selectedWeaponKey: "normal"
      },
      shotHistory: [
        buildShotFeedback({
          family: "medium-arc-default",
          visualOutcomeLabel: "blocked",
          shotResolutionCategory: "wall-hit",
          fingerprint: "normal:right:2:up:3:180:2200"
        })
      ]
    });

    expect(plan.family).toBe("blocked-terrain-escape");
    expect(plan.strategy.weaponKey).toBe("heavy");
    expect(plan.projectilePolicyReason).toContain("Heavy");
  });

  it("avoids repeating an identical weak shot fingerprint inside the same attempt", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: buildBaseStrategy(),
      selectionDetails: buildSelectionDetails(),
      runtime: {
        windDirection: "right",
        windNormalized: 0.12,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1,
        projectileGravityMultiplier: 1,
        projectileWindInfluenceMultiplier: 1,
        projectileSplashRadius: 18,
        projectileDamageMin: 8,
        projectileDamageMax: 14,
        projectileWindupSeconds: 0.18,
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: "normal",
        selectedWeaponKey: "normal"
      },
      shotHistory: [
        buildShotFeedback({
          family: "medium-arc-default",
          visualOutcomeLabel: "no-meaningful-visual-change",
          fingerprint: "normal:right:3:up:4:180:2360",
          angleTapCount: 3,
          powerTapCount: 4
        }),
        buildShotFeedback({
          shotNumber: 2,
          family: "medium-arc-default",
          visualOutcomeLabel: "no-meaningful-visual-change",
          fingerprint: "normal:right:3:up:4:180:2360",
          angleTapCount: 3,
          powerTapCount: 4
        })
      ]
    });

    expect(plan.fingerprint).not.toBe("normal:right:3:up:4:180:2360");
    expect(plan.adaptationReason).toContain("Avoid replaying the same weak shot fingerprint");
  });
});
