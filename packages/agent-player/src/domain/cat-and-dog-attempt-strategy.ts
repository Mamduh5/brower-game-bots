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
  stepBudgetReached: z.boolean(),
  turnsObserved: z.number().int().nonnegative(),
  shotResolutionsObserved: z.number().int().nonnegative(),
  directHits: z.number().int().nonnegative(),
  splashHits: z.number().int().nonnegative(),
  wallHits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  healsObserved: z.number().int().nonnegative(),
  damageDealt: z.number().int().nonnegative().nullable(),
  damageTaken: z.number().int().nonnegative().nullable()
});
export type CatAndDogAttemptDiagnostics = z.infer<typeof CatAndDogAttemptDiagnosticsSchema>;

export const CatAndDogAttemptFeedbackSchema = z.object({
  attemptNumber: z.number().int().positive(),
  outcome: CatAndDogAttemptOutcomeSchema,
  strategy: CatAndDogAttemptStrategySchema,
  diagnostics: CatAndDogAttemptDiagnosticsSchema
});
export type CatAndDogAttemptFeedback = z.infer<typeof CatAndDogAttemptFeedbackSchema>;

export interface CatAndDogRankedAttemptMemoryEntry {
  attemptNumber: number;
  outcome: CatAndDogAttemptOutcome;
  score: number;
  fingerprint: string;
}

export interface CatAndDogStrategySelectionDetails {
  selectedFingerprint: string;
  exactUseCount: number;
  topReferenceAttemptNumber: number | null;
  topReferenceScore: number | null;
  topReferenceDistance: number | null;
  selectionMode: "initial" | "catalog" | "exact-replay" | "one-knob-mutation" | "wider-fallback";
  changedKnob: "none" | "angleTapCount" | "powerTapCount" | "settleMs" | "turnResolutionWaitMs" | "weaponKey";
  expectedMutationReason: string | null;
  rankedRecentAttempts: readonly CatAndDogRankedAttemptMemoryEntry[];
}

export interface CatAndDogStrategySelection {
  strategy: CatAndDogAttemptStrategy;
  selectionReason: string;
  selectionDetails: CatAndDogStrategySelectionDetails;
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
  },
  {
    weaponKey: "light",
    angleDirection: "right",
    angleTapCount: 2,
    powerDirection: "up",
    powerTapCount: 3,
    settleMs: 210,
    turnResolutionWaitMs: 2800
  },
  {
    weaponKey: "heavy",
    angleDirection: "right",
    angleTapCount: 1,
    powerDirection: "up",
    powerTapCount: 4,
    settleMs: 230,
    turnResolutionWaitMs: 3100
  }
] as const;

type CatAndDogStrategyVariant = (typeof BASELINE_VARIANTS)[number] | (typeof EXPLORE_VARIANTS)[number];
type RefinementKnob = CatAndDogStrategySelectionDetails["changedKnob"];

interface CatAndDogCandidateMeta {
  origin: "catalog" | "anchor-exact" | "anchor-mutation";
  selectionMode: Exclude<CatAndDogStrategySelectionDetails["selectionMode"], "initial">;
  changedKnob: RefinementKnob;
  expectedMutationReason: string | null;
  anchorAttemptNumber: number | null;
}

function getCandidateOriginPriority(meta: CatAndDogCandidateMeta): number {
  if (meta.origin === "anchor-exact") {
    return 3;
  }

  if (meta.origin === "anchor-mutation") {
    return 2;
  }

  return 1;
}

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

function cloneStrategyWithAttemptNumber(
  strategy: CatAndDogAttemptStrategy,
  attemptNumber: number
): CatAndDogAttemptStrategy {
  return CatAndDogAttemptStrategySchema.parse({
    ...strategy,
    attemptNumber
  });
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

function clampTapCount(value: number): number {
  return Math.max(0, Math.min(5, value));
}

function clampSettleMs(value: number): number {
  return Math.max(0, value);
}

function clampTurnResolutionWaitMs(value: number): number {
  return Math.max(1_200, value);
}

function hasStalled(feedback: CatAndDogAttemptFeedback): boolean {
  return (
    feedback.outcome === "UNKNOWN" &&
    (
      feedback.diagnostics.shotsFired === 0 ||
      feedback.diagnostics.playerTurnReadyObserved !== true ||
      (
        feedback.diagnostics.shotResolutionsObserved === 0 &&
        feedback.diagnostics.endOverlayObserved !== true
      )
    )
  );
}

export function scoreCatAndDogAttemptFeedback(feedback: CatAndDogAttemptFeedback): number {
  const damageDealt = feedback.diagnostics.damageDealt ?? 0;
  const damageTaken = feedback.diagnostics.damageTaken ?? 0;
  const unresolvedShots = Math.max(0, feedback.diagnostics.shotsFired - feedback.diagnostics.shotResolutionsObserved);
  const lowResolutionPenalty =
    unresolvedShots * 95 +
    (feedback.diagnostics.shotsFired > 0 && feedback.diagnostics.shotResolutionsObserved === 0 ? 140 : 0);
  const unproductiveShotPenalty =
    feedback.diagnostics.shotsFired > 0 &&
    damageDealt === 0 &&
    feedback.diagnostics.directHits === 0 &&
    feedback.diagnostics.splashHits === 0
      ? 75
      : 0;
  const wallHeavyPenalty =
    feedback.diagnostics.wallHits >= Math.max(1, feedback.diagnostics.shotsFired) ? 95 : 0;

  return (
    (feedback.outcome === "WIN" ? 1_900 : 0) +
    (feedback.outcome === "LOSS" ? 320 : 0) +
    (feedback.outcome === "UNKNOWN" ? 40 : 0) +
    damageDealt * 14 -
    damageTaken * 6 +
    feedback.diagnostics.directHits * 180 +
    feedback.diagnostics.splashHits * 95 -
    feedback.diagnostics.wallHits * 55 +
    feedback.diagnostics.healsObserved * 10 -
    feedback.diagnostics.misses * 45 +
    feedback.diagnostics.shotResolutionsObserved * 28 +
    feedback.diagnostics.shotsFired * 4 +
    feedback.diagnostics.turnsObserved * 6 +
    (feedback.diagnostics.endOverlayObserved ? 40 : 0) +
    (feedback.diagnostics.gameplayEnteredObserved ? 12 : 0) +
    (feedback.diagnostics.playerTurnReadyObserved ? 14 : 0) -
    (feedback.diagnostics.stepBudgetReached ? 80 : 0) -
    lowResolutionPenalty -
    unproductiveShotPenalty -
    wallHeavyPenalty
  );
}

function isWeakAttempt(feedback: CatAndDogAttemptFeedback): boolean {
  const score = scoreCatAndDogAttemptFeedback(feedback);
  return (
    feedback.outcome !== "WIN" &&
    (
      score < 180 ||
      (
        (feedback.diagnostics.damageDealt ?? 0) === 0 &&
        feedback.diagnostics.directHits === 0 &&
        feedback.diagnostics.splashHits === 0 &&
        (
          feedback.diagnostics.wallHits > 0 ||
          feedback.diagnostics.misses > 0 ||
          feedback.diagnostics.stepBudgetReached
        )
      )
    )
  );
}

function buildAnchorCandidates(input: {
  anchor: CatAndDogAttemptFeedback;
  attemptNumber: number;
  strategyMode: CatAndDogStrategyMode;
}): Array<{ strategy: CatAndDogAttemptStrategy; meta: CatAndDogCandidateMeta }> {
  const { anchor, attemptNumber, strategyMode } = input;
  const base = cloneStrategyWithAttemptNumber(anchor.strategy, attemptNumber);
  const candidates: Array<{ strategy: CatAndDogAttemptStrategy; meta: CatAndDogCandidateMeta }> = [
    {
      strategy: base,
      meta: {
        origin: "anchor-exact",
        selectionMode: "exact-replay",
        changedKnob: "none",
        expectedMutationReason: "Replay the strongest recent live shot exactly before widening.",
        anchorAttemptNumber: anchor.attemptNumber
      }
    }
  ];

  const pushMutation = (
    strategy: CatAndDogAttemptStrategy,
    changedKnob: RefinementKnob,
    expectedMutationReason: string
  ) => {
    candidates.push({
      strategy,
      meta: {
        origin: "anchor-mutation",
        selectionMode: "one-knob-mutation",
        changedKnob,
        expectedMutationReason,
        anchorAttemptNumber: anchor.attemptNumber
      }
    });
  };

  const angleMinus = clampTapCount(base.angleTapCount - 1);
  if (angleMinus !== base.angleTapCount) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          angleTapCount: angleMinus
        },
        attemptNumber
      ),
      "angleTapCount",
      "Nudge the aim angle one tap lower around the best recent attempt."
    );
  }

  const anglePlus = clampTapCount(base.angleTapCount + 1);
  if (anglePlus !== base.angleTapCount) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          angleTapCount: anglePlus
        },
        attemptNumber
      ),
      "angleTapCount",
      "Nudge the aim angle one tap higher around the best recent attempt."
    );
  }

  const powerMinus = clampTapCount(base.powerTapCount - 1);
  if (powerMinus !== base.powerTapCount) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          powerTapCount: powerMinus
        },
        attemptNumber
      ),
      "powerTapCount",
      "Reduce power by one tap to refine the strongest recent shot."
    );
  }

  const powerPlus = clampTapCount(base.powerTapCount + 1);
  if (powerPlus !== base.powerTapCount) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          powerTapCount: powerPlus
        },
        attemptNumber
      ),
      "powerTapCount",
      "Increase power by one tap to refine the strongest recent shot."
    );
  }

  const settleMinus = clampSettleMs(base.settleMs - 40);
  if (settleMinus !== base.settleMs) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          settleMs: settleMinus
        },
        attemptNumber
      ),
      "settleMs",
      "Shorten the pre-fire settle slightly while staying in the same shot region."
    );
  }

  const settlePlus = clampSettleMs(base.settleMs + 40);
  if (settlePlus !== base.settleMs) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          settleMs: settlePlus
        },
        attemptNumber
      ),
      "settleMs",
      "Lengthen the pre-fire settle slightly while staying in the same shot region."
    );
  }

  const waitMinus = clampTurnResolutionWaitMs(base.turnResolutionWaitMs - 300);
  if (waitMinus !== base.turnResolutionWaitMs) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          turnResolutionWaitMs: waitMinus
        },
        attemptNumber
      ),
      "turnResolutionWaitMs",
      "Shorten turn-resolution wait slightly around the strongest recent attempt."
    );
  }

  const waitPlus = clampTurnResolutionWaitMs(base.turnResolutionWaitMs + 300);
  if (waitPlus !== base.turnResolutionWaitMs) {
    pushMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          turnResolutionWaitMs: waitPlus
        },
        attemptNumber
      ),
      "turnResolutionWaitMs",
      "Lengthen turn-resolution wait slightly around the strongest recent attempt."
    );
  }

  if (strategyMode === "explore") {
    const alternateWeapon = base.weaponKey === "normal" ? "light" : base.weaponKey === "light" ? "heavy" : null;
    if (alternateWeapon) {
      pushMutation(
        cloneStrategyWithAttemptNumber(
          {
            ...base,
            weaponKey: alternateWeapon
          },
          attemptNumber
        ),
        "weaponKey",
        "Try one nearby weapon variant without changing the rest of the strongest recent shot."
      );
    }
  }

  return candidates;
}

function buildRankedRecentMemory(
  history: readonly CatAndDogAttemptFeedback[],
  limit = 3
): readonly (CatAndDogRankedAttemptMemoryEntry & { strategy: CatAndDogAttemptStrategy })[] {
  const recentHistory = history.slice(-6);
  const ranked = recentHistory
    .map((feedback) => ({
      attemptNumber: feedback.attemptNumber,
      outcome: feedback.outcome,
      score: scoreCatAndDogAttemptFeedback(feedback),
      fingerprint: toFingerprint(feedback.strategy),
      strategy: feedback.strategy
    }))
    .sort((left, right) => right.score - left.score || right.attemptNumber - left.attemptNumber);
  const unique: (CatAndDogRankedAttemptMemoryEntry & { strategy: CatAndDogAttemptStrategy })[] = [];

  for (const entry of ranked) {
    if (unique.some((existing) => existing.fingerprint === entry.fingerprint)) {
      continue;
    }

    unique.push(entry);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

function buildSelectionReason(input: {
  history: readonly CatAndDogAttemptFeedback[];
  exactUseCount: number;
  topReference: (CatAndDogRankedAttemptMemoryEntry & { strategy: CatAndDogAttemptStrategy }) | null;
  topReferenceDistance: number | null;
  weakRepeatCount: number;
  hasWeakHistory: boolean;
  selectedMeta: CatAndDogCandidateMeta;
}): string {
  const { history, exactUseCount, topReference, topReferenceDistance, weakRepeatCount, hasWeakHistory, selectedMeta } = input;
  if (history.length === 0) {
    return "initial-candidate";
  }

  if (selectedMeta.selectionMode === "exact-replay") {
    return "anchor-exact-replay";
  }

  if (selectedMeta.selectionMode === "one-knob-mutation") {
    return `anchor-one-knob-${selectedMeta.changedKnob}`;
  }

  if (selectedMeta.selectionMode === "wider-fallback") {
    return "anchor-wider-fallback";
  }

  if (
    topReference &&
    topReference.score >= 260 &&
    topReferenceDistance !== null &&
    topReferenceDistance <= 2
  ) {
    return exactUseCount === 0 ? "exploit-top-recent-region" : "exploit-top-recent-repeat";
  }

  if (weakRepeatCount > 0 && exactUseCount === 0) {
    return "avoid-weaker-repeat";
  }

  const latest = history[history.length - 1];
  if (latest && hasStalled(latest)) {
    return exactUseCount === 0 ? "stall-recovery-longer-resolution" : "stall-recovery-neighbor-search";
  }

  if (latest?.outcome === "LOSS") {
    return exactUseCount === 0 ? "terminal-loss-neighbor-search" : "terminal-loss-avoid-repeat";
  }

  if (latest && scoreCatAndDogAttemptFeedback(latest) > 120) {
    return exactUseCount === 0 ? "progress-neighbor-search" : "progress-avoid-repeat";
  }

  if (hasWeakHistory && exactUseCount === 0) {
    return "avoid-weaker-repeat";
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
  const baseCandidates = variants.map((variant, index) => ({
    index,
    strategy: toStrategy(variant, input.attemptNumber, strategyMode),
    meta: {
      origin: "catalog" as const,
      selectionMode: "catalog" as const,
      changedKnob: "none" as const,
      expectedMutationReason: null,
      anchorAttemptNumber: null
    }
  }));

  if (history.length === 0) {
    const selected = baseCandidates[(input.attemptNumber - 1) % baseCandidates.length];
    if (!selected) {
      throw new Error("Expected at least one cat-and-dog strategy candidate.");
    }

    return {
      strategy: selected.strategy,
      selectionReason: "initial-candidate",
      selectionDetails: {
        selectedFingerprint: toFingerprint(selected.strategy),
        exactUseCount: 0,
        topReferenceAttemptNumber: null,
        topReferenceScore: null,
        topReferenceDistance: null,
        selectionMode: "initial",
        changedKnob: "none",
        expectedMutationReason: null,
        rankedRecentAttempts: []
      }
    };
  }

  const rankedRecentMemory = buildRankedRecentMemory(history);
  const topReference = rankedRecentMemory[0] ?? null;
  const anchorFeedback =
    topReference
      ? history.find((entry) => entry.attemptNumber === topReference.attemptNumber) ?? null
      : null;
  const weakFingerprintCounts = new Map<string, number>();
  for (const previous of history) {
    if (!isWeakAttempt(previous)) {
      continue;
    }

    const fingerprint = toFingerprint(previous.strategy);
    weakFingerprintCounts.set(fingerprint, (weakFingerprintCounts.get(fingerprint) ?? 0) + 1);
  }
  const hasWeakHistory = weakFingerprintCounts.size > 0;
  const localFailureCount =
    anchorFeedback
      ? history
          .slice(-3)
          .filter(
            (entry) =>
              entry.attemptNumber !== anchorFeedback.attemptNumber &&
              strategyDistance(entry.strategy, anchorFeedback.strategy) <= 1 &&
              entry.outcome !== "WIN" &&
              scoreCatAndDogAttemptFeedback(entry) <= scoreCatAndDogAttemptFeedback(anchorFeedback)
          ).length
      : 0;
  const anchorCandidates =
    anchorFeedback && topReference && topReference.score >= 220
      ? buildAnchorCandidates({
          anchor: anchorFeedback,
          attemptNumber: input.attemptNumber,
          strategyMode
        })
      : [];
  const candidates = [
    ...anchorCandidates.map((candidate, index) => ({
      index,
      strategy: candidate.strategy,
      meta: candidate.meta
    })),
    ...baseCandidates.map((candidate, index) => ({
      ...candidate,
      index: anchorCandidates.length + index
    }))
  ];
  const uniqueCandidates = new Map<
    string,
    {
      index: number;
      strategy: CatAndDogAttemptStrategy;
      meta: CatAndDogCandidateMeta;
    }
  >();

  for (const candidate of candidates) {
    const fingerprint = toFingerprint(candidate.strategy);
    const existing = uniqueCandidates.get(fingerprint);
    if (!existing) {
      uniqueCandidates.set(fingerprint, candidate);
      continue;
    }

    const candidatePriority = getCandidateOriginPriority(candidate.meta);
    const existingPriority = getCandidateOriginPriority(existing.meta);
    if (
      candidatePriority > existingPriority ||
      (candidatePriority === existingPriority && candidate.index < existing.index)
    ) {
      uniqueCandidates.set(fingerprint, candidate);
    }
  }

  const scored = [...uniqueCandidates.values()].map((candidate) => {
    const candidateFingerprint = toFingerprint(candidate.strategy);
    let score = 1_000 - candidate.index * 20;
    let exactUseCount = 0;
    let weakRepeatCount = weakFingerprintCounts.get(candidateFingerprint) ?? 0;
    const anchorDistance =
      anchorFeedback ? strategyDistance(candidate.strategy, anchorFeedback.strategy) : null;

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

        score += Math.max(0, scoreCatAndDogAttemptFeedback(previous) - 220) / 7;

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
      } else {
        const progress = scoreCatAndDogAttemptFeedback(previous);
        if (distance <= 2) {
          score += 24 - distance * 8;
        }

        if (progress > 120 && distance <= 4) {
          score += 48 - distance * 10;
        }

        if ((previous.diagnostics.damageDealt ?? 0) > (previous.diagnostics.damageTaken ?? 0) && distance <= 4) {
          score += 32 - distance * 6;
        }

        if (previous.diagnostics.directHits > 0 && candidate.strategy.angleDirection === previous.strategy.angleDirection) {
          score += 20;
        }

        if (previous.diagnostics.splashHits > 0 && candidate.strategy.powerDirection === previous.strategy.powerDirection) {
          score += 14;
        }
      }
    }

    if (candidate.meta.selectionMode === "exact-replay") {
      score += localFailureCount === 0 ? 360 : localFailureCount >= 2 ? 90 : 150;
    }

    if (candidate.meta.selectionMode === "one-knob-mutation") {
      score += localFailureCount === 0 ? 100 : localFailureCount >= 2 ? 220 : 280;
    }

    if (
      anchorFeedback &&
      candidate.meta.origin === "catalog" &&
      anchorDistance !== null &&
      anchorDistance > 2
    ) {
      score -= localFailureCount >= 2 ? 140 : 280;
    }

    if (
      anchorFeedback &&
      candidate.meta.origin === "catalog" &&
      anchorDistance !== null &&
      anchorDistance > 1 &&
      localFailureCount < 2
    ) {
      score -= 120;
    }

    if (topReference && topReference.score >= 260 && anchorDistance !== null) {
      if (anchorDistance === 0) {
        score += localFailureCount === 0 ? 170 : 90;
      } else if (anchorDistance === 1) {
        score += localFailureCount >= 1 ? 120 : 45;
      } else if (anchorDistance === 2) {
        score -= localFailureCount >= 2 ? 25 : 180;
      } else {
        score -= localFailureCount >= 2 ? 140 : 320;
      }
    }

    for (const [memoryIndex, memory] of rankedRecentMemory.entries()) {
      const distance = strategyDistance(candidate.strategy, memory.strategy);
      const baseWeight = memoryIndex === 0 ? 230 : memoryIndex === 1 ? 120 : 70;
      if (memory.score >= 260) {
        if (distance <= 1) {
          score += baseWeight;
        } else if (distance <= 3) {
          score += Math.max(0, baseWeight - distance * 45);
        } else {
          score -= Math.min(160, (distance - 3) * 40);
        }
      } else if (memory.score >= 160 && distance <= 3) {
        score += Math.max(0, baseWeight - distance * 35);
      }

      if (memory.score >= 220 && candidate.strategy.weaponKey === memory.strategy.weaponKey) {
        score += 18;
      }
    }

    if (topReference && candidate.strategy.weaponKey !== topReference.strategy.weaponKey && topReference.score >= 260) {
      score -= 35;
    }

    if (weakRepeatCount > 0) {
      score -= 180 + weakRepeatCount * 75;
      if (exactUseCount > 0) {
        score -= 320;
      }
    }

    return {
      ...candidate,
      exactUseCount,
      weakRepeatCount,
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
    selectionReason: buildSelectionReason({
      history,
      exactUseCount: best.exactUseCount,
      topReference,
      topReferenceDistance: topReference ? strategyDistance(best.strategy, topReference.strategy) : null,
      weakRepeatCount: best.weakRepeatCount,
      hasWeakHistory,
      selectedMeta:
        best.meta.origin === "catalog" && anchorFeedback && localFailureCount >= 2
          ? {
              ...best.meta,
              selectionMode: "wider-fallback"
            }
          : best.meta
    }),
    selectionDetails: {
      selectedFingerprint: toFingerprint(best.strategy),
      exactUseCount: best.exactUseCount,
      topReferenceAttemptNumber: topReference?.attemptNumber ?? null,
      topReferenceScore: topReference?.score ?? null,
      topReferenceDistance: topReference ? strategyDistance(best.strategy, topReference.strategy) : null,
      selectionMode:
        best.meta.origin === "catalog" && anchorFeedback && localFailureCount >= 2
          ? "wider-fallback"
          : best.meta.selectionMode,
      changedKnob: best.meta.changedKnob,
      expectedMutationReason: best.meta.expectedMutationReason,
      rankedRecentAttempts: rankedRecentMemory.map((entry) => ({
        attemptNumber: entry.attemptNumber,
        outcome: entry.outcome,
        score: entry.score,
        fingerprint: entry.fingerprint
      }))
    }
  };
}

export function buildCatAndDogAttemptStrategy(input: {
  attemptNumber: number;
  strategyMode?: CatAndDogStrategyMode;
}): CatAndDogAttemptStrategy {
  return selectCatAndDogAttemptStrategy(input).strategy;
}
