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

export const CatAndDogAttemptOutcomeSchema = z.enum(["WIN", "LOSS", "UNKNOWN"]);
export type CatAndDogAttemptOutcome = z.infer<typeof CatAndDogAttemptOutcomeSchema>;

export const CatAndDogAttemptDiagnosticsSchema = z.object({
  semanticActionCount: z.number().int().nonnegative(),
  shotsFired: z.number().int().nonnegative(),
  waitActions: z.number().int().nonnegative(),
  gameplayEnteredObserved: z.boolean(),
  playerTurnReadyObserved: z.boolean(),
  endOverlayObserved: z.boolean(),
  stepBudgetReached: z.boolean()
});
export type CatAndDogAttemptDiagnostics = z.infer<typeof CatAndDogAttemptDiagnosticsSchema>;

export const CatAndDogAttemptFeedbackSchema = z.object({
  attemptNumber: z.number().int().positive(),
  outcome: CatAndDogAttemptOutcomeSchema,
  strategy: CatAndDogAttemptStrategySchema,
  diagnostics: CatAndDogAttemptDiagnosticsSchema
});
export type CatAndDogAttemptFeedback = z.infer<typeof CatAndDogAttemptFeedbackSchema>;

export interface CatAndDogStrategySelection {
  strategy: CatAndDogAttemptStrategy;
  selectionReason: string;
}

const BASELINE_VARIANTS = [
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 150,
    turnResolutionWaitMs: 2200
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 180,
    turnResolutionWaitMs: 2400
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 200,
    turnResolutionWaitMs: 2600
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 3,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 220,
    turnResolutionWaitMs: 2800
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 170,
    turnResolutionWaitMs: 2400
  },
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 150,
    turnResolutionWaitMs: 2300
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "down",
    powerTapCount: 1,
    settleMs: 160,
    turnResolutionWaitMs: 2300
  },
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 190,
    turnResolutionWaitMs: 2500
  }
] as const;

const EXPLORE_VARIANTS = [
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 3,
    powerDirection: "up",
    powerTapCount: 4,
    settleMs: 240,
    turnResolutionWaitMs: 3000
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 4,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 250,
    turnResolutionWaitMs: 3200
  },
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 3,
    powerDirection: "up",
    powerTapCount: 2,
    settleMs: 190,
    turnResolutionWaitMs: 2600
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 4,
    settleMs: 210,
    turnResolutionWaitMs: 2900
  },
  {
    weaponKey: "normal",
    angleDirection: "left",
    angleTapCount: 1,
    powerDirection: "down",
    powerTapCount: 1,
    settleMs: 140,
    turnResolutionWaitMs: 2400
  },
  {
    weaponKey: "normal",
    angleDirection: "right",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 1,
    settleMs: 140,
    turnResolutionWaitMs: 2200
  }
] as const;

type CatAndDogStrategyVariant = (typeof BASELINE_VARIANTS)[number] | (typeof EXPLORE_VARIANTS)[number];

function getVariants(strategyMode: CatAndDogStrategyMode): readonly CatAndDogStrategyVariant[] {
  return strategyMode === "explore" ? EXPLORE_VARIANTS : BASELINE_VARIANTS;
}

function toStrategy(
  variant: CatAndDogStrategyVariant,
  attemptNumber: number,
  strategyMode: CatAndDogStrategyMode
): CatAndDogAttemptStrategy {
  return CatAndDogAttemptStrategySchema.parse({
    attemptNumber,
    strategyMode,
    difficulty: "easy",
    ...variant
  });
}

function toFingerprint(strategy: CatAndDogAttemptStrategy): string {
  return [
    strategy.weaponKey,
    strategy.angleDirection,
    strategy.angleTapCount,
    strategy.powerDirection,
    strategy.powerTapCount,
    strategy.settleMs,
    strategy.turnResolutionWaitMs
  ].join(":");
}

function strategyDistance(left: CatAndDogAttemptStrategy, right: CatAndDogAttemptStrategy): number {
  let distance = 0;
  if (left.weaponKey !== right.weaponKey) {
    distance += 2;
  }

  if (left.angleDirection !== right.angleDirection) {
    distance += 2;
  }
  distance += Math.abs(left.angleTapCount - right.angleTapCount);

  if (left.powerDirection !== right.powerDirection) {
    distance += 2;
  }
  distance += Math.abs(left.powerTapCount - right.powerTapCount);
  distance += Math.ceil(Math.abs(left.turnResolutionWaitMs - right.turnResolutionWaitMs) / 400);
  distance += Math.ceil(Math.abs(left.settleMs - right.settleMs) / 120);
  return distance;
}

function hasStalled(feedback: CatAndDogAttemptFeedback): boolean {
  return (
    feedback.outcome === "UNKNOWN" &&
    (
      feedback.diagnostics.shotsFired === 0 ||
      feedback.diagnostics.playerTurnReadyObserved !== true ||
      feedback.diagnostics.endOverlayObserved !== true
    )
  );
}

function buildSelectionReason(history: readonly CatAndDogAttemptFeedback[], exactUseCount: number): string {
  if (history.length === 0) {
    return "initial-candidate";
  }

  const latest = history[history.length - 1];
  if (latest && hasStalled(latest)) {
    return exactUseCount === 0 ? "stall-recovery-longer-resolution" : "stall-recovery-neighbor-search";
  }

  if (latest?.outcome === "LOSS") {
    return exactUseCount === 0 ? "terminal-loss-neighbor-search" : "terminal-loss-avoid-repeat";
  }

  return exactUseCount === 0 ? "untried-variant" : "least-repeated-variant";
}

export function selectCatAndDogAttemptStrategy(input: {
  attemptNumber: number;
  strategyMode?: CatAndDogStrategyMode;
  history?: readonly CatAndDogAttemptFeedback[];
}): CatAndDogStrategySelection {
  const strategyMode = input.strategyMode ?? "baseline";
  const variants = getVariants(strategyMode);
  const history = (input.history ?? []).map((entry) => CatAndDogAttemptFeedbackSchema.parse(entry));
  const candidates = variants.map((variant, index) => ({
    index,
    strategy: toStrategy(variant, input.attemptNumber, strategyMode)
  }));

  if (history.length === 0) {
    const selected = candidates[(input.attemptNumber - 1) % candidates.length];
    if (!selected) {
      throw new Error("Expected at least one cat-and-dog strategy candidate.");
    }

    return {
      strategy: selected.strategy,
      selectionReason: "initial-candidate"
    };
  }

  const scored = candidates.map((candidate) => {
    const candidateFingerprint = toFingerprint(candidate.strategy);
    let score = 1_000 - candidate.index * 20;
    let exactUseCount = 0;

    for (const previous of history) {
      const previousFingerprint = toFingerprint(previous.strategy);
      const distance = strategyDistance(candidate.strategy, previous.strategy);
      const repeatedExact = previousFingerprint === candidateFingerprint;
      if (repeatedExact) {
        exactUseCount += 1;
      }

      if (previous.outcome === "WIN") {
        if (repeatedExact) {
          score -= 600;
        }
        continue;
      }

      if (previous.outcome === "LOSS") {
        if (repeatedExact) {
          score -= 160;
        }

        if (distance <= 3) {
          score += 90 - distance * 15;
        }

        if (candidate.strategy.angleDirection === previous.strategy.angleDirection) {
          score += 12;
        }

        if (candidate.strategy.powerDirection === previous.strategy.powerDirection) {
          score += 8;
        }

        continue;
      }

      if (repeatedExact) {
        score -= previous.diagnostics.shotsFired === 0 ? 220 : 140;
      }

      if (hasStalled(previous)) {
        if (candidate.strategy.turnResolutionWaitMs > previous.strategy.turnResolutionWaitMs) {
          score += 80;
        }

        if (candidate.strategy.settleMs >= previous.strategy.settleMs) {
          score += 20;
        }

        if (candidate.strategy.powerTapCount >= previous.strategy.powerTapCount) {
          score += 12;
        }

        if (candidate.strategy.angleDirection === "right") {
          score += 10;
        }
      } else if (distance <= 2) {
        score += 24 - distance * 8;
      }
    }

    return {
      ...candidate,
      exactUseCount,
      score
    };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.exactUseCount !== right.exactUseCount) {
      return left.exactUseCount - right.exactUseCount;
    }

    return left.index - right.index;
  });

  const [best] = scored;
  if (!best) {
    throw new Error("Expected at least one cat-and-dog strategy candidate.");
  }

  return {
    strategy: best.strategy,
    selectionReason: buildSelectionReason(history, best.exactUseCount)
  };
}

export function buildCatAndDogAttemptStrategy(input: {
  attemptNumber: number;
  strategyMode?: CatAndDogStrategyMode;
}): CatAndDogAttemptStrategy {
  return selectCatAndDogAttemptStrategy(input).strategy;
}
