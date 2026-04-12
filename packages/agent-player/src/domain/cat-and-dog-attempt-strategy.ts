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

export const CatAndDogVisionShotOutcomeLabelSchema = z.enum([
  "none",
  "no-meaningful-visual-change",
  "self-side-impact",
  "short",
  "blocked",
  "near-target",
  "target-side-impact",
  "long",
  "unknown"
]);
export type CatAndDogVisionShotOutcomeLabel = z.infer<typeof CatAndDogVisionShotOutcomeLabelSchema>;

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
  visionChangeSignals: z.number().int().nonnegative(),
  visionStrongChangeSignals: z.number().int().nonnegative(),
  visionTargetSideSignals: z.number().int().nonnegative(),
  visionTerrainSideSignals: z.number().int().nonnegative(),
  visionNoChangeShots: z.number().int().nonnegative(),
  visionNearTargetShots: z.number().int().nonnegative(),
  visionBlockedShots: z.number().int().nonnegative(),
  visionShortShots: z.number().int().nonnegative(),
  visionLongShots: z.number().int().nonnegative(),
  visionSelfSideShots: z.number().int().nonnegative(),
  lastVisionShotOutcomeLabel: CatAndDogVisionShotOutcomeLabelSchema,
  damageDealt: z.number().int().nonnegative().nullable(),
  damageTaken: z.number().int().nonnegative().nullable(),
  runtimeStateAvailable: z.boolean().default(false),
  windValue: z.number().nullable().default(null),
  windNormalized: z.number().nullable().default(null),
  windDirection: z.enum(["left", "right", "calm", "unknown"]).default("unknown"),
  projectileLabel: z.string().nullable().default(null),
  projectileWeight: z.number().nullable().default(null),
  projectileLaunchSpeedMultiplier: z.number().nullable().default(null),
  projectileGravityMultiplier: z.number().nullable().default(null),
  projectileWindInfluenceMultiplier: z.number().nullable().default(null),
  projectileSplashRadius: z.number().nullable().default(null),
  projectileDamageMin: z.number().nullable().default(null),
  projectileDamageMax: z.number().nullable().default(null),
  projectileWindupSeconds: z.number().nullable().default(null),
  preparedShotAngle: z.number().nullable().default(null),
  preparedShotPower: z.number().nullable().default(null),
  preparedShotKey: z.string().nullable().default(null)
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

export interface CatAndDogPlannerInputs {
  windDirection: CatAndDogAttemptDiagnostics["windDirection"];
  windNormalized: number | null;
  projectileLabel: string | null;
  projectileWeight: number | null;
  projectileLaunchSpeedMultiplier: number | null;
  projectileGravityMultiplier: number | null;
  projectileWindInfluenceMultiplier: number | null;
  preparedShotAngle: number | null;
  preparedShotPower: number | null;
  preparedShotKey: string | null;
  recentVisualOutcomeLabel: CatAndDogVisionShotOutcomeLabel;
}

export interface CatAndDogPlannerIntent {
  weaponKey: CatAndDogAttemptStrategy["weaponKey"];
  angleDirection: CatAndDogAttemptStrategy["angleDirection"];
  angleTapCount: number;
  powerDirection: CatAndDogAttemptStrategy["powerDirection"];
  powerTapCount: number;
  settleMs: number;
  turnResolutionWaitMs: number;
}

export interface CatAndDogStrategySelectionDetails {
  selectedFingerprint: string;
  exactUseCount: number;
  topReferenceAttemptNumber: number | null;
  topReferenceScore: number | null;
  topReferenceDistance: number | null;
  selectionMode: "initial" | "catalog" | "exact-replay" | "one-knob-mutation" | "runtime-planned" | "wider-fallback";
  changedKnob: "none" | "angleTapCount" | "powerTapCount" | "settleMs" | "turnResolutionWaitMs" | "weaponKey";
  triggeredByVisualOutcomeLabel: CatAndDogVisionShotOutcomeLabel;
  plannerMode: "none" | "runtime-shot-planner";
  plannerReason: string | null;
  plannerInputs: CatAndDogPlannerInputs | null;
  plannerIntent: CatAndDogPlannerIntent | null;
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
  origin: "catalog" | "anchor-exact" | "anchor-mutation" | "planner";
  selectionMode: Exclude<CatAndDogStrategySelectionDetails["selectionMode"], "initial">;
  changedKnob: RefinementKnob;
  triggeredByVisualOutcomeLabel: CatAndDogVisionShotOutcomeLabel;
  plannerMode: CatAndDogStrategySelectionDetails["plannerMode"];
  plannerReason: string | null;
  plannerInputs: CatAndDogPlannerInputs | null;
  plannerIntent: CatAndDogPlannerIntent | null;
  expectedMutationReason: string | null;
  anchorAttemptNumber: number | null;
}

function getCandidateOriginPriority(meta: CatAndDogCandidateMeta): number {
  if (meta.origin === "planner") {
    return 4;
  }

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

function resolveVisualCorrectionSignal(
  feedback: CatAndDogAttemptFeedback | null | undefined
): CatAndDogVisionShotOutcomeLabel {
  if (!feedback) {
    return "none";
  }

  const explicit = feedback.diagnostics.lastVisionShotOutcomeLabel;
  if (
    explicit !== "none" &&
    explicit !== "unknown" &&
    explicit !== "no-meaningful-visual-change"
  ) {
    return explicit;
  }

  if (feedback.diagnostics.visionNearTargetShots > 0) {
    return "near-target";
  }

  if (feedback.diagnostics.visionBlockedShots > 0) {
    return "blocked";
  }

  if (feedback.diagnostics.visionShortShots > 0) {
    return "short";
  }

  if (feedback.diagnostics.visionLongShots > 0) {
    return "long";
  }

  if (feedback.diagnostics.visionSelfSideShots > 0) {
    return "self-side-impact";
  }

  if (feedback.diagnostics.visionTargetSideSignals > 0) {
    return "target-side-impact";
  }

  if (feedback.diagnostics.visionNoChangeShots > 0) {
    return "no-meaningful-visual-change";
  }

  return "none";
}

function isMeaningfulVisualCorrectionSignal(
  label: CatAndDogVisionShotOutcomeLabel
): boolean {
  return (
    label !== "none" &&
    label !== "unknown" &&
    label !== "no-meaningful-visual-change"
  );
}

function resolveRecentLocalVisualCorrectionContext(input: {
  history: readonly CatAndDogAttemptFeedback[];
  anchorFeedback: CatAndDogAttemptFeedback | null;
}): {
  signal: CatAndDogVisionShotOutcomeLabel;
  sourceAttemptNumber: number | null;
} {
  const { history, anchorFeedback } = input;

  for (const feedback of [...history].reverse()) {
    const signal = resolveVisualCorrectionSignal(feedback);
    if (!isMeaningfulVisualCorrectionSignal(signal)) {
      continue;
    }

    if (
      anchorFeedback &&
      strategyDistance(feedback.strategy, anchorFeedback.strategy) > 1
    ) {
      continue;
    }

    return {
      signal,
      sourceAttemptNumber: feedback.attemptNumber
    };
  }

  return {
    signal: "none",
    sourceAttemptNumber: null
  };
}

function buildVisualCorrectionReason(label: CatAndDogVisionShotOutcomeLabel): string | null {
  switch (label) {
    case "short":
      return "Visual correction: previous shot looked short, so add one power tap.";
    case "long":
      return "Visual correction: previous shot looked long, so reduce power by one tap.";
    case "blocked":
      return "Visual correction: previous shot looked blocked, so raise angle more aggressively.";
    case "near-target":
      return "Visual correction: previous shot landed near target, so refine with a tiny local nudge.";
    case "target-side-impact":
      return "Visual correction: previous shot reached target side, so exploit the same local region.";
    case "self-side-impact":
      return "Visual correction: previous shot hit too close to self side, so recover with a larger rightward angle change.";
    default:
      return null;
  }
}

function isTailwindForAnchor(feedback: CatAndDogAttemptFeedback): boolean {
  return feedback.strategy.angleDirection === "right" && feedback.diagnostics.windDirection === "right";
}

function isHeadwindForAnchor(feedback: CatAndDogAttemptFeedback): boolean {
  return feedback.strategy.angleDirection === "right" && feedback.diagnostics.windDirection === "left";
}

function hasStrongWindEffect(feedback: CatAndDogAttemptFeedback): boolean {
  const windMagnitude = Math.abs(feedback.diagnostics.windNormalized ?? 0);
  const influence = feedback.diagnostics.projectileWindInfluenceMultiplier ?? 1;
  return windMagnitude * influence >= 0.75;
}

function resolveVisualCorrectionMagnitude(input: {
  feedback: CatAndDogAttemptFeedback;
  label: CatAndDogVisionShotOutcomeLabel;
}): number {
  const { feedback, label } = input;
  const strongWindEffect = hasStrongWindEffect(feedback);
  const heavyProjectile = (feedback.diagnostics.projectileWeight ?? 1) >= 1.35;
  const highGravityProjectile = (feedback.diagnostics.projectileGravityMultiplier ?? 1) >= 1.15;
  const lowLaunchSpeedProjectile = (feedback.diagnostics.projectileLaunchSpeedMultiplier ?? 1) <= 0.93;
  const selfSideRecovery = label === "self-side-impact";

  if (label === "short") {
    if (isHeadwindForAnchor(feedback) && strongWindEffect) {
      return 2;
    }

    return heavyProjectile || highGravityProjectile || lowLaunchSpeedProjectile ? 2 : 1;
  }

  if (label === "long") {
    if (isTailwindForAnchor(feedback) && strongWindEffect) {
      return 2;
    }

    return strongWindEffect && !heavyProjectile ? 2 : 1;
  }

  if (label === "blocked") {
    return heavyProjectile || highGravityProjectile || isHeadwindForAnchor(feedback) ? 3 : 2;
  }

  if (selfSideRecovery) {
    return strongWindEffect || heavyProjectile ? 3 : 2;
  }

  return 1;
}

function buildRuntimeCorrectionSuffix(
  feedback: CatAndDogAttemptFeedback,
  magnitude: number
): string | null {
  if (magnitude <= 1) {
    return null;
  }

  if (isHeadwindForAnchor(feedback) && hasStrongWindEffect(feedback)) {
    return " Headwind plus current projectile wind response justify a larger correction.";
  }

  if (isTailwindForAnchor(feedback) && hasStrongWindEffect(feedback)) {
    return " Tailwind plus current projectile wind response justify a larger correction.";
  }

  if ((feedback.diagnostics.projectileWeight ?? 1) >= 1.35) {
    return " Heavy projectile behavior justifies a larger correction.";
  }

  if ((feedback.diagnostics.projectileGravityMultiplier ?? 1) >= 1.15) {
    return " Higher projectile drop justifies a larger correction.";
  }

  return " Current projectile behavior justifies a larger correction.";
}

function hasRuntimeShotPlannerContext(feedback: CatAndDogAttemptFeedback): boolean {
  const diagnostics = feedback.diagnostics;
  return (
    diagnostics.runtimeStateAvailable === true &&
    (
      diagnostics.windNormalized !== null ||
      diagnostics.projectileWeight !== null ||
      diagnostics.projectileLaunchSpeedMultiplier !== null ||
      diagnostics.projectileGravityMultiplier !== null ||
      diagnostics.projectileWindInfluenceMultiplier !== null ||
      diagnostics.preparedShotAngle !== null ||
      diagnostics.preparedShotPower !== null ||
      diagnostics.preparedShotKey !== null
    )
  );
}

function buildPlannerInputs(
  feedback: CatAndDogAttemptFeedback,
  visualCorrectionSignal: CatAndDogVisionShotOutcomeLabel
): CatAndDogPlannerInputs {
  return {
    windDirection: feedback.diagnostics.windDirection,
    windNormalized: feedback.diagnostics.windNormalized,
    projectileLabel: feedback.diagnostics.projectileLabel,
    projectileWeight: feedback.diagnostics.projectileWeight,
    projectileLaunchSpeedMultiplier: feedback.diagnostics.projectileLaunchSpeedMultiplier,
    projectileGravityMultiplier: feedback.diagnostics.projectileGravityMultiplier,
    projectileWindInfluenceMultiplier: feedback.diagnostics.projectileWindInfluenceMultiplier,
    preparedShotAngle: feedback.diagnostics.preparedShotAngle,
    preparedShotPower: feedback.diagnostics.preparedShotPower,
    preparedShotKey: feedback.diagnostics.preparedShotKey,
    recentVisualOutcomeLabel: visualCorrectionSignal
  };
}

function resolveDominantChangedKnob(
  base: CatAndDogAttemptStrategy,
  planned: CatAndDogAttemptStrategy
): RefinementKnob {
  if (base.weaponKey !== planned.weaponKey) {
    return "weaponKey";
  }

  const deltas: Array<{ knob: RefinementKnob; distance: number }> = [
    { knob: "angleTapCount", distance: Math.abs(base.angleTapCount - planned.angleTapCount) },
    { knob: "powerTapCount", distance: Math.abs(base.powerTapCount - planned.powerTapCount) },
    { knob: "settleMs", distance: Math.abs(base.settleMs - planned.settleMs) },
    {
      knob: "turnResolutionWaitMs",
      distance: Math.abs(base.turnResolutionWaitMs - planned.turnResolutionWaitMs)
    }
  ];
  deltas.sort((left, right) => right.distance - left.distance);
  return deltas[0]?.distance ? deltas[0].knob : "none";
}

function buildPlannerIntent(strategy: CatAndDogAttemptStrategy): CatAndDogPlannerIntent {
  return {
    weaponKey: strategy.weaponKey,
    angleDirection: strategy.angleDirection,
    angleTapCount: strategy.angleTapCount,
    powerDirection: strategy.powerDirection,
    powerTapCount: strategy.powerTapCount,
    settleMs: strategy.settleMs,
    turnResolutionWaitMs: strategy.turnResolutionWaitMs
  };
}

function buildRuntimePlannerCandidate(input: {
  anchor: CatAndDogAttemptFeedback;
  attemptNumber: number;
  visualCorrectionSignal: CatAndDogVisionShotOutcomeLabel;
}): { strategy: CatAndDogAttemptStrategy; meta: CatAndDogCandidateMeta } | null {
  const { anchor, attemptNumber, visualCorrectionSignal } = input;
  if (!hasRuntimeShotPlannerContext(anchor)) {
    return null;
  }

  const base = cloneStrategyWithAttemptNumber(anchor.strategy, attemptNumber);
  const plannerInputs = buildPlannerInputs(anchor, visualCorrectionSignal);
  const preparedShotAngle = anchor.diagnostics.preparedShotAngle;
  const preparedShotPower = anchor.diagnostics.preparedShotPower;
  const windMagnitude = Math.abs(anchor.diagnostics.windNormalized ?? 0);
  const strongWindEffect = hasStrongWindEffect(anchor);
  const heavyProjectile = (anchor.diagnostics.projectileWeight ?? 1) >= 1.35;
  const highGravityProjectile = (anchor.diagnostics.projectileGravityMultiplier ?? 1) >= 1.15;
  const lowLaunchSpeedProjectile = (anchor.diagnostics.projectileLaunchSpeedMultiplier ?? 1) <= 0.93;
  const highWindInfluenceProjectile = (anchor.diagnostics.projectileWindInfluenceMultiplier ?? 1) >= 1.4;
  const reasons: string[] = [];

  let weaponKey = base.weaponKey;
  let angleDirection = base.angleDirection;
  let angleDelta = 0;
  let powerDelta = 0;
  let settleDelta = 0;
  let turnResolutionWaitDelta = 0;

  if (isHeadwindForAnchor(anchor) && windMagnitude >= 0.45) {
    powerDelta += highWindInfluenceProjectile ? 2 : 1;
    if (heavyProjectile || highGravityProjectile || lowLaunchSpeedProjectile) {
      angleDelta += 1;
    }
    reasons.push("Headwind compensation around the last live shot context.");
  } else if (isTailwindForAnchor(anchor) && windMagnitude >= 0.45) {
    powerDelta -= highWindInfluenceProjectile ? 2 : 1;
    if (!heavyProjectile && (preparedShotAngle ?? 50) >= 58) {
      angleDelta -= 1;
    }
    reasons.push("Tailwind trim around the last live shot context.");
  }

  if (heavyProjectile || highGravityProjectile) {
    angleDelta += 1;
    reasons.push("Projectile drop profile favors a slightly higher arc.");
  }

  switch (visualCorrectionSignal) {
    case "short":
      powerDelta += highWindInfluenceProjectile || isHeadwindForAnchor(anchor) ? 2 : 1;
      if (lowLaunchSpeedProjectile || highGravityProjectile || (preparedShotAngle ?? 50) <= 38) {
        angleDelta += 1;
      }
      reasons.push("Recent impact looked short, so extend carry.");
      break;
    case "long":
      powerDelta -= isTailwindForAnchor(anchor) || highWindInfluenceProjectile ? 2 : 1;
      if (!heavyProjectile && (preparedShotAngle ?? 50) >= 60) {
        angleDelta -= 1;
      }
      reasons.push("Recent impact looked long, so trim carry.");
      break;
    case "blocked":
      angleDelta += heavyProjectile || highGravityProjectile ? 3 : 2;
      if (isHeadwindForAnchor(anchor) && highWindInfluenceProjectile) {
        powerDelta += 1;
      }
      reasons.push("Recent impact looked blocked, so raise the arc.");
      break;
    case "near-target":
      settleDelta += 40;
      turnResolutionWaitDelta += 120;
      if (isHeadwindForAnchor(anchor)) {
        powerDelta += 1;
      } else if (isTailwindForAnchor(anchor)) {
        powerDelta -= 1;
      } else if ((preparedShotAngle ?? 50) <= 48) {
        angleDelta += 1;
      }
      reasons.push("Recent impact was near target, so refine locally.");
      break;
    case "target-side-impact":
      settleDelta += 50;
      turnResolutionWaitDelta += 160;
      if (isHeadwindForAnchor(anchor) && highWindInfluenceProjectile) {
        powerDelta += 1;
      } else if (isTailwindForAnchor(anchor) && windMagnitude >= 0.45) {
        powerDelta -= 1;
      }
      reasons.push("Recent impact reached target side, so exploit the same region.");
      break;
    case "self-side-impact":
      angleDirection = "right";
      angleDelta += heavyProjectile || highGravityProjectile ? 3 : 2;
      if (isHeadwindForAnchor(anchor)) {
        powerDelta += 1;
      }
      if (
        base.weaponKey !== "normal" &&
        strongWindEffect &&
        (base.weaponKey === "light" || base.weaponKey === "super")
      ) {
        weaponKey = "normal";
        reasons.push("Switch back to a steadier projectile after self-side impact.");
      }
      reasons.push("Recent impact stayed on self side, so recover with a safer launch.");
      break;
    default:
      if (preparedShotPower !== null && preparedShotPower < 420 && isHeadwindForAnchor(anchor)) {
        powerDelta += 1;
        reasons.push("Prepared power looked low for the current headwind.");
      }
      break;
  }

  const planned = cloneStrategyWithAttemptNumber(
    {
      ...base,
      weaponKey,
      angleDirection,
      angleTapCount: clampTapCount(base.angleTapCount + angleDelta),
      powerTapCount: clampTapCount(base.powerTapCount + powerDelta),
      settleMs: clampSettleMs(base.settleMs + settleDelta),
      turnResolutionWaitMs: clampTurnResolutionWaitMs(base.turnResolutionWaitMs + turnResolutionWaitDelta)
    },
    attemptNumber
  );
  const changedKnob = resolveDominantChangedKnob(base, planned);
  const plannerReason =
    reasons.length > 0
      ? reasons.join(" ")
      : "Use wind, projectile behavior, and prepared-shot context to replay the strongest live shot intentionally.";

  return {
    strategy: planned,
    meta: {
      origin: "planner",
      selectionMode: "runtime-planned",
      changedKnob,
      triggeredByVisualOutcomeLabel:
        isMeaningfulVisualCorrectionSignal(visualCorrectionSignal) ? visualCorrectionSignal : "none",
      plannerMode: "runtime-shot-planner",
      plannerReason,
      plannerInputs,
      plannerIntent: buildPlannerIntent(planned),
      expectedMutationReason: plannerReason,
      anchorAttemptNumber: anchor.attemptNumber
    }
  };
}

export function scoreCatAndDogAttemptFeedback(feedback: CatAndDogAttemptFeedback): number {
  const damageDealt = feedback.diagnostics.damageDealt ?? 0;
  const damageTaken = feedback.diagnostics.damageTaken ?? 0;
  const unresolvedShots = Math.max(0, feedback.diagnostics.shotsFired - feedback.diagnostics.shotResolutionsObserved);
  const visualProgressScore =
    feedback.diagnostics.visionNearTargetShots * 145 +
    feedback.diagnostics.visionTargetSideSignals * 90 +
    feedback.diagnostics.visionStrongChangeSignals * 35 +
    feedback.diagnostics.visionChangeSignals * 20 -
    feedback.diagnostics.visionBlockedShots * 55 -
    feedback.diagnostics.visionShortShots * 45 -
    feedback.diagnostics.visionLongShots * 35 -
    feedback.diagnostics.visionSelfSideShots * 95 -
    feedback.diagnostics.visionTerrainSideSignals * 30 -
    feedback.diagnostics.visionNoChangeShots * 55;
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
    feedback.diagnostics.healsObserved * 10 +
    visualProgressScore -
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
  visualCorrectionSignal: CatAndDogVisionShotOutcomeLabel;
}): Array<{ strategy: CatAndDogAttemptStrategy; meta: CatAndDogCandidateMeta }> {
  const { anchor, attemptNumber, strategyMode, visualCorrectionSignal } = input;
  const base = cloneStrategyWithAttemptNumber(anchor.strategy, attemptNumber);
  const visualCorrectionMagnitude = resolveVisualCorrectionMagnitude({
    feedback: anchor,
    label: visualCorrectionSignal
  });
  const candidates: Array<{ strategy: CatAndDogAttemptStrategy; meta: CatAndDogCandidateMeta }> = [];
  const plannerCandidate = buildRuntimePlannerCandidate({
    anchor,
    attemptNumber,
    visualCorrectionSignal
  });

  if (plannerCandidate) {
    candidates.push(plannerCandidate);
  }

  candidates.push({
    strategy: base,
    meta: {
      origin: "anchor-exact",
      selectionMode: "exact-replay",
      changedKnob: "none",
      triggeredByVisualOutcomeLabel:
        visualCorrectionSignal === "near-target" || visualCorrectionSignal === "target-side-impact"
          ? visualCorrectionSignal
          : "none",
      plannerMode: "none",
      plannerReason: null,
      plannerInputs: null,
      plannerIntent: null,
      expectedMutationReason:
        visualCorrectionSignal === "near-target" || visualCorrectionSignal === "target-side-impact"
          ? buildVisualCorrectionReason(visualCorrectionSignal)
          : "Replay the strongest recent live shot exactly before widening.",
      anchorAttemptNumber: anchor.attemptNumber
    }
  });

  const pushMutation = (
    strategy: CatAndDogAttemptStrategy,
    changedKnob: RefinementKnob,
    expectedMutationReason: string,
    triggeredByVisualOutcomeLabel: CatAndDogVisionShotOutcomeLabel = "none"
  ) => {
    candidates.push({
      strategy,
      meta: {
        origin: "anchor-mutation",
        selectionMode: "one-knob-mutation",
        changedKnob,
        triggeredByVisualOutcomeLabel,
        plannerMode: "none",
        plannerReason: null,
        plannerInputs: null,
        plannerIntent: null,
        expectedMutationReason,
        anchorAttemptNumber: anchor.attemptNumber
      }
    });
  };

  const pushVisualCorrectionMutation = (
    strategy: CatAndDogAttemptStrategy,
    changedKnob: RefinementKnob,
    label: CatAndDogVisionShotOutcomeLabel
  ) => {
    const reason = buildVisualCorrectionReason(label);
    if (!reason) {
      return;
    }

    pushMutation(
      strategy,
      changedKnob,
      `${reason}${buildRuntimeCorrectionSuffix(anchor, visualCorrectionMagnitude) ?? ""}`,
      label
    );
  };

  if (visualCorrectionSignal === "short") {
    pushVisualCorrectionMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          powerTapCount: clampTapCount(base.powerTapCount + visualCorrectionMagnitude)
        },
        attemptNumber
      ),
      "powerTapCount",
      "short"
    );
  }

  if (visualCorrectionSignal === "long") {
    pushVisualCorrectionMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          powerTapCount: clampTapCount(base.powerTapCount - visualCorrectionMagnitude)
        },
        attemptNumber
      ),
      "powerTapCount",
      "long"
    );
  }

  if (visualCorrectionSignal === "blocked") {
    pushVisualCorrectionMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          angleTapCount: clampTapCount(base.angleTapCount + visualCorrectionMagnitude)
        },
        attemptNumber
      ),
      "angleTapCount",
      "blocked"
    );
  }

  if (visualCorrectionSignal === "near-target") {
    pushVisualCorrectionMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          angleTapCount: clampTapCount(base.angleTapCount + 1)
        },
        attemptNumber
      ),
      "angleTapCount",
      "near-target"
    );
  }

  if (visualCorrectionSignal === "target-side-impact") {
    pushVisualCorrectionMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          settleMs: clampSettleMs(base.settleMs + 40)
        },
        attemptNumber
      ),
      "settleMs",
      "target-side-impact"
    );
  }

  if (visualCorrectionSignal === "self-side-impact") {
    pushVisualCorrectionMutation(
      cloneStrategyWithAttemptNumber(
        {
          ...base,
          angleDirection: "right",
          angleTapCount: clampTapCount(base.angleTapCount + visualCorrectionMagnitude)
        },
        attemptNumber
      ),
      "angleTapCount",
      "self-side-impact"
    );
  }

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

  if (selectedMeta.plannerMode !== "none") {
    return "runtime-shot-planner";
  }

  if (selectedMeta.triggeredByVisualOutcomeLabel !== "none") {
    return `visual-correction-${selectedMeta.triggeredByVisualOutcomeLabel}`;
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
      triggeredByVisualOutcomeLabel: "none" as const,
      plannerMode: "none" as const,
      plannerReason: null,
      plannerInputs: null,
      plannerIntent: null,
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
        triggeredByVisualOutcomeLabel: "none",
        plannerMode: "none",
        plannerReason: null,
        plannerInputs: null,
        plannerIntent: null,
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
  const { signal: visualCorrectionSignal, sourceAttemptNumber: visualCorrectionSourceAttemptNumber } =
    resolveRecentLocalVisualCorrectionContext({
      history,
      anchorFeedback
    });
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
  const canUseRuntimePlanner = anchorFeedback && hasRuntimeShotPlannerContext(anchorFeedback);
  const anchorCandidates =
    anchorFeedback && topReference && (topReference.score >= 220 || canUseRuntimePlanner)
      ? buildAnchorCandidates({
          anchor: anchorFeedback,
          attemptNumber: input.attemptNumber,
          strategyMode,
          visualCorrectionSignal
        })
      : [];
  const plannerCandidateAvailable = anchorCandidates.some(
    (candidate) => candidate.meta.plannerMode === "runtime-shot-planner"
  );
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
      if (
        visualCorrectionSignal === "short" ||
        visualCorrectionSignal === "long" ||
        visualCorrectionSignal === "blocked" ||
        visualCorrectionSignal === "self-side-impact"
      ) {
        score -= 180;
      }

      if (
        visualCorrectionSignal === "near-target" ||
        visualCorrectionSignal === "target-side-impact"
      ) {
        score += 110;
      }
    }

    if (candidate.meta.selectionMode === "runtime-planned") {
      score += topReference && topReference.score >= 260 ? 980 : 840;
      if (candidate.meta.triggeredByVisualOutcomeLabel !== "none") {
        score += 240;
      }
      if (candidate.meta.changedKnob !== "none") {
        score += 110;
      }
    }

    if (candidate.meta.selectionMode === "one-knob-mutation") {
      score += localFailureCount === 0 ? 100 : localFailureCount >= 2 ? 220 : 280;
      if (candidate.meta.triggeredByVisualOutcomeLabel !== "none") {
        score += 360;
      }
    }

    if (isMeaningfulVisualCorrectionSignal(visualCorrectionSignal)) {
      if (candidate.meta.triggeredByVisualOutcomeLabel === visualCorrectionSignal) {
        score += localFailureCount >= 2 ? 180 : 340;
      } else if (
        candidate.meta.origin === "anchor-mutation" &&
        candidate.meta.changedKnob !== "none"
      ) {
        score -= 120;
      } else if (candidate.meta.origin === "catalog") {
        score -= localFailureCount >= 2 ? 80 : 220;
      }

      if (
        anchorFeedback &&
        candidate.meta.origin === "catalog" &&
        anchorDistance !== null &&
        anchorDistance > 1
      ) {
        score -= 120;
      }
    }

    if (plannerCandidateAvailable && candidate.meta.plannerMode === "none") {
      if (candidate.meta.origin === "catalog") {
        score -= 420;
      } else if (candidate.meta.selectionMode === "exact-replay") {
        score -= 180;
      } else if (candidate.meta.selectionMode === "one-knob-mutation") {
        score -= 140;
      }
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
      triggeredByVisualOutcomeLabel: best.meta.triggeredByVisualOutcomeLabel,
      plannerMode: best.meta.plannerMode,
      plannerReason: best.meta.plannerReason,
      plannerInputs: best.meta.plannerInputs,
      plannerIntent: best.meta.plannerIntent,
      expectedMutationReason:
        best.meta.expectedMutationReason ??
        (
          visualCorrectionSourceAttemptNumber !== null && isMeaningfulVisualCorrectionSignal(visualCorrectionSignal)
            ? `Derived from visual outcome on attempt ${visualCorrectionSourceAttemptNumber}.`
            : null
        ),
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
