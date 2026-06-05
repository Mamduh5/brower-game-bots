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
  it("keeps the attempt-selected weapon when runtime starts on the default normal weapon", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: {
        ...buildBaseStrategy(),
        weaponKey: "heavy"
      },
      selectionDetails: buildSelectionDetails({
        plannerFamily: null,
        plannerCategory: null
      }),
      runtime: {
        windDirection: "right",
        windNormalized: 0.18,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1.01,
        projectileGravityMultiplier: 1.04,
        projectileWindInfluenceMultiplier: 1.22,
        projectileSplashRadius: 64,
        projectileDamageMin: 9,
        projectileDamageMax: 23,
        projectileWindupSeconds: 0.17,
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: null,
        selectedWeaponKey: "normal"
      },
      shotHistory: []
    });

    expect(plan.family).toBe("medium-arc-default");
    expect(plan.strategy.weaponKey).toBe("heavy");
    expect(plan.fingerprint.startsWith("heavy:")).toBe(true);
  });

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

  it("does not treat unresolved vision-only failures as full-strength family exhaustion", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: buildBaseStrategy(),
      selectionDetails: buildSelectionDetails({
        plannerFamily: "medium-arc-default",
        plannerCategory: "default-runtime"
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
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: null,
        selectedWeaponKey: "normal"
      },
      shotHistory: [
        buildShotFeedback({
          family: "medium-arc-default",
          visualOutcomeLabel: "short",
          shotResolved: false,
          shotResolutionCategory: "none",
          hintCategory: "none",
          hintText: null,
          fingerprint: "normal:right:3:up:4:180:2200"
        }),
        buildShotFeedback({
          shotNumber: 2,
          family: "medium-arc-default",
          visualOutcomeLabel: "short",
          shotResolved: false,
          shotResolutionCategory: "none",
          hintCategory: "none",
          hintText: null,
          fingerprint: "normal:right:3:up:5:180:2200"
        }),
        buildShotFeedback({
          shotNumber: 3,
          family: "medium-arc-default",
          visualOutcomeLabel: "self-side-impact",
          shotResolved: false,
          shotResolutionCategory: "none",
          hintCategory: "none",
          hintText: null,
          fingerprint: "normal:right:4:up:5:180:2200"
        })
      ]
    });

    expect(plan.source).toBe("within-attempt-correction");
    expect(plan.family).toBe("self-side-recovery");
    expect(plan.familySwitchReason).toContain("self side");
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

  it("opens impossible mode with Normal to bait the CPU full heal before Super", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: {
        ...buildBaseStrategy(),
        difficulty: "impossible",
        strategyMode: "explore"
      },
      selectionDetails: buildSelectionDetails(),
      runtime: {
        windDirection: "left",
        windValue: -99.74319434217466,
        windNormalized: -0.525,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1.01,
        projectileGravityMultiplier: 1.04,
        projectileWindInfluenceMultiplier: 1.22,
        projectileSplashRadius: 64,
        projectileDamageMin: 9,
        projectileDamageMax: 23,
        projectileWindupSeconds: 0.17,
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: null,
        selectedWeaponKey: "normal",
        currentAimAngle: 42,
        currentAimPower: 500,
        aimAngleTap: 1.8,
        aimPowerTap: 18,
        playerHp: 110,
        cpuHp: 110,
        currentPlayerX: 150,
        targetPlayerX: 810,
        wallHp: 150,
        wallDestroyed: false,
        availableWeaponKeys: ["normal", "light", "heavy", "super"]
      },
      shotHistory: []
    });

    expect(plan.strategy.weaponKey).toBe("normal");
    expect(plan.expectedDamage).toBeGreaterThanOrEqual(25);
    expect(plan.planReason).toContain("Impossible heal bait");
    expect(plan.adaptationReason).toContain("preserving Super");
  });

  it("retries Normal heal bait when the impossible opener underperforms before Super", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: {
        ...buildBaseStrategy(),
        difficulty: "impossible",
        strategyMode: "explore"
      },
      selectionDetails: buildSelectionDetails(),
      runtime: {
        windDirection: "calm",
        windValue: 4.167442846469939,
        windNormalized: 0.022,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1.01,
        projectileGravityMultiplier: 1.04,
        projectileWindInfluenceMultiplier: 1.22,
        projectileSplashRadius: 64,
        projectileDamageMin: 9,
        projectileDamageMax: 23,
        projectileWindupSeconds: 0.17,
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: null,
        selectedWeaponKey: "normal",
        currentAimAngle: 34.8,
        currentAimPower: 770,
        aimAngleTap: 1.8,
        aimPowerTap: 18,
        playerHp: 77,
        cpuHp: 110,
        currentPlayerX: 150,
        targetPlayerX: 810,
        wallHp: 150,
        wallDestroyed: false,
        availableWeaponKeys: ["normal", "light", "heavy", "super"]
      },
      shotHistory: [
        buildShotFeedback({
          family: "near-target-finisher",
          category: "finisher",
          fingerprint: "normal:left:4:up:15:240:2400:34.8:770",
          weaponKey: "normal",
          visualOutcomeLabel: "short",
          shotResolutionCategory: "none",
          hintCategory: "none",
          hintText: null,
          damageDealtDelta: 0,
          meaningfulProgress: false,
          familyFailed: true
        })
      ]
    });

    expect(plan.strategy.weaponKey).toBe("normal");
    expect(plan.planReason).toContain("Previous heal-bait shot did not force");
    expect(plan.adaptationReason).toContain("Retry Normal heal bait");
  });

  it("prioritizes Heavy after Super on impossible when Normal is not lethal", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: {
        ...buildBaseStrategy(),
        difficulty: "impossible",
        strategyMode: "explore",
        settleMs: 300,
        turnResolutionWaitMs: 3000
      },
      selectionDetails: buildSelectionDetails({
        plannerFamily: "self-side-recovery",
        plannerCategory: "recovery"
      }),
      runtime: {
        windDirection: "left",
        windValue: -99.74319434217466,
        windNormalized: -0.525,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1.01,
        projectileGravityMultiplier: 1.04,
        projectileWindInfluenceMultiplier: 1.22,
        projectileSplashRadius: 64,
        projectileDamageMin: 9,
        projectileDamageMax: 23,
        projectileWindupSeconds: 0.17,
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: null,
        selectedWeaponKey: "normal",
        currentAimAngle: 63.6,
        currentAimPower: 840,
        aimAngleTap: 1.8,
        aimPowerTap: 18,
        playerHp: 110,
        cpuHp: 110,
        currentPlayerX: 150,
        targetPlayerX: 810,
        wallHp: 82,
        wallDestroyed: false,
        availableWeaponKeys: ["normal", "light", "heavy"]
      },
      shotHistory: [
        buildShotFeedback({
          family: "near-target-finisher",
          category: "finisher",
          fingerprint: "super:right:12:up:19:300:2400:63.6:840",
          weaponKey: "super",
          visualOutcomeLabel: "blocked",
          shotResolutionCategory: "direct-hit",
          damageDealtDelta: 55,
          meaningfulProgress: true,
          familyFailed: true
        })
      ]
    });

    expect(plan.strategy.weaponKey).toBe("heavy");
    expect(plan.strategy.targetAngle).toBe(43.8);
    expect(plan.strategy.targetPower).toBe(840);
    expect(plan.expectedDamage).toBeGreaterThan(0);
    expect(plan.expectedDamage).toBeLessThan(33);
    expect(plan.planReason).toContain("Impossible damage race");
    expect(plan.adaptationReason).toContain("post-Super");
  });

  it("allows Normal finishers after a successful impossible heal-bait opener", () => {
    const plan = planCatAndDogShotExecution({
      attemptStrategy: {
        ...buildBaseStrategy(),
        difficulty: "impossible",
        strategyMode: "explore",
        settleMs: 300,
        turnResolutionWaitMs: 3000
      },
      selectionDetails: buildSelectionDetails({
        plannerFamily: "self-side-recovery",
        plannerCategory: "recovery"
      }),
      runtime: {
        windDirection: "left",
        windValue: -99.74319434217466,
        windNormalized: -0.525,
        projectileLabel: "Normal",
        projectileWeight: 1,
        projectileLaunchSpeedMultiplier: 1.01,
        projectileGravityMultiplier: 1.04,
        projectileWindInfluenceMultiplier: 1.22,
        projectileSplashRadius: 64,
        projectileDamageMin: 9,
        projectileDamageMax: 23,
        projectileWindupSeconds: 0.17,
        preparedShotAngle: null,
        preparedShotPower: null,
        preparedShotKey: null,
        selectedWeaponKey: "normal",
        currentAimAngle: 63.6,
        currentAimPower: 840,
        aimAngleTap: 1.8,
        aimPowerTap: 18,
        playerHp: 110,
        cpuHp: 55,
        currentPlayerX: 150,
        targetPlayerX: 810,
        wallHp: 82,
        wallDestroyed: false,
        availableWeaponKeys: ["normal", "light", "heavy"]
      },
      shotHistory: [
        buildShotFeedback({
          fingerprint: "normal:left:6:up:14:180:2200:31.2:768",
          weaponKey: "normal",
          damageDealtDelta: 33,
          meaningfulProgress: true,
          familyFailed: false
        }),
        buildShotFeedback({
          shotNumber: 2,
          family: "near-target-finisher",
          category: "finisher",
          fingerprint: "super:right:12:up:19:300:2400:63.6:840",
          weaponKey: "super",
          visualOutcomeLabel: "blocked",
          shotResolutionCategory: "direct-hit",
          damageDealtDelta: 55,
          meaningfulProgress: true,
          familyFailed: true
        })
      ]
    });

    expect(plan.strategy.weaponKey).toBe("normal");
    expect(plan.expectedDamage).toBeGreaterThanOrEqual(25);
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
