import { z } from "zod";

export const CatAndDogStrategyModeSchema = z.enum(["baseline", "explore"]);
export type CatAndDogStrategyMode = z.infer<typeof CatAndDogStrategyModeSchema>;

export const CatAndDogAttemptStrategySchema = z.object({
  attemptNumber: z.number().int().positive(),
  strategyMode: CatAndDogStrategyModeSchema,
  difficulty: z.enum(["easy", "normal", "hard", "impossible"]),
  weaponKey: z.enum(["normal", "light", "heavy", "super", "heal"]),
  angleDirection: z.enum(["left", "right"]),
  angleTapCount: z.number().int().min(0).max(5),
  powerDirection: z.enum(["up", "down"]),
  powerTapCount: z.number().int().min(0).max(5),
  settleMs: z.number().int().nonnegative(),
  turnResolutionWaitMs: z.number().int().positive()
});
export type CatAndDogAttemptStrategy = z.infer<typeof CatAndDogAttemptStrategySchema>;

const BASELINE_VARIANTS = [
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 1,
    powerDirection: "down",
    powerTapCount: 1,
    settleMs: 120,
    turnResolutionWaitMs: 1600
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 160,
    turnResolutionWaitMs: 1600
  },
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 1,
    settleMs: 180,
    turnResolutionWaitMs: 1800
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 140,
    turnResolutionWaitMs: 1700
  }
] as const;

const EXPLORE_VARIANTS = [
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 3,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 220,
    turnResolutionWaitMs: 1900
  },
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 3,
    powerDirection: "down",
    powerTapCount: 2,
    settleMs: 180,
    turnResolutionWaitMs: 1800
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 1,
    settleMs: 100,
    turnResolutionWaitMs: 1500
  }
] as const;

export function buildCatAndDogAttemptStrategy(input: {
  attemptNumber: number;
  strategyMode?: CatAndDogStrategyMode;
}): CatAndDogAttemptStrategy {
  const strategyMode = input.strategyMode ?? "baseline";
  const variants = strategyMode === "explore" ? EXPLORE_VARIANTS : BASELINE_VARIANTS;
  const variant = variants[(input.attemptNumber - 1) % variants.length];

  return CatAndDogAttemptStrategySchema.parse({
    attemptNumber: input.attemptNumber,
    strategyMode,
    difficulty: "easy",
    ...variant
  });
}
