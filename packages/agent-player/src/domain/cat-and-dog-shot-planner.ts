import type {
  CatAndDogAttemptStrategy,
  CatAndDogPlannerCategory,
  CatAndDogShotFamily,
  CatAndDogStrategySelectionDetails,
  CatAndDogVisionShotOutcomeLabel
} from "./cat-and-dog-attempt-strategy.js";

export interface CatAndDogShotPlannerRuntimeContext {
  windDirection: "left" | "right" | "calm" | "unknown";
  windNormalized: number | null;
  projectileLabel: string | null;
  projectileWeight: number | null;
  projectileLaunchSpeedMultiplier: number | null;
  projectileGravityMultiplier: number | null;
  projectileWindInfluenceMultiplier: number | null;
  projectileSplashRadius: number | null;
  projectileDamageMin: number | null;
  projectileDamageMax: number | null;
  projectileWindupSeconds: number | null;
  preparedShotAngle: number | null;
  preparedShotPower: number | null;
  preparedShotKey: string | null;
  selectedWeaponKey: string | null;
}

export interface CatAndDogShotFeedbackRecord {
  shotNumber: number;
  family: CatAndDogShotFamily;
  category: CatAndDogPlannerCategory;
  fingerprint: string;
  weaponKey: CatAndDogAttemptStrategy["weaponKey"];
  angleDirection: CatAndDogAttemptStrategy["angleDirection"];
  angleTapCount: number;
  powerDirection: CatAndDogAttemptStrategy["powerDirection"];
  powerTapCount: number;
  visualOutcomeLabel: CatAndDogVisionShotOutcomeLabel;
  shotResolutionCategory: string | null;
  hintCategory: string | null;
  hintText: string | null;
  damageDealtDelta: number | null;
  damageTakenDelta: number | null;
  shotResolved: boolean;
  playerTurnReadyAfter: boolean;
  turnCounterAfter: number | null;
  outcomeAfterShot: "WIN" | "LOSS" | "UNKNOWN" | null;
  meaningfulProgress: boolean;
  familyFailed: boolean;
}

export interface CatAndDogShotExecutionPlan {
  shotNumber: number;
  family: CatAndDogShotFamily;
  category: CatAndDogPlannerCategory;
  strategy: CatAndDogAttemptStrategy;
  fingerprint: string;
  source:
    | "attempt-opening"
    | "within-attempt-correction"
    | "family-abandonment"
    | "stability-reset"
    | "finisher";
  planReason: string;
  familySwitchReason: string | null;
  projectilePolicyReason: string | null;
  adaptationReason: string | null;
  inputsUsed: readonly string[];
}

export interface PlanCatAndDogShotInput {
  attemptStrategy: CatAndDogAttemptStrategy;
  selectionDetails: Pick<
    CatAndDogStrategySelectionDetails,
    "plannerFamily" | "plannerCategory" | "plannerFamilySwitchReason" | "plannerInputs"
  >;
  runtime: CatAndDogShotPlannerRuntimeContext;
  shotHistory: readonly CatAndDogShotFeedbackRecord[];
}

interface FamilyStats {
  uses: number;
  failingUses: number;
  selfSide: number;
  blocked: number;
  short: number;
  noChange: number;
  nearTarget: number;
  targetSide: number;
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

function mapPreparedAngleToTapCount(preparedShotAngle: number | null): number | null {
  if (preparedShotAngle === null) {
    return null;
  }

  if (preparedShotAngle <= 35) {
    return 1;
  }

  if (preparedShotAngle <= 45) {
    return 2;
  }

  if (preparedShotAngle <= 55) {
    return 3;
  }

  if (preparedShotAngle <= 65) {
    return 4;
  }

  return 5;
}

function mapPreparedPowerToTapCount(preparedShotPower: number | null): number | null {
  if (preparedShotPower === null) {
    return null;
  }

  if (preparedShotPower <= 440) {
    return 1;
  }

  if (preparedShotPower <= 560) {
    return 2;
  }

  if (preparedShotPower <= 660) {
    return 3;
  }

  if (preparedShotPower <= 760) {
    return 4;
  }

  return 5;
}

function toPlannerCategory(family: CatAndDogShotFamily): CatAndDogPlannerCategory {
  switch (family) {
    case "blocked-terrain-escape":
      return "blocked-escape";
    case "self-side-recovery":
      return "recovery";
    case "near-target-finisher":
      return "finisher";
    default:
      return "default-runtime";
  }
}

function buildFamilyStats(
  shotHistory: readonly CatAndDogShotFeedbackRecord[]
): ReadonlyMap<CatAndDogShotFamily, FamilyStats> {
  const map = new Map<CatAndDogShotFamily, FamilyStats>();

  for (const shot of shotHistory) {
    const current = map.get(shot.family) ?? {
      uses: 0,
      failingUses: 0,
      selfSide: 0,
      blocked: 0,
      short: 0,
      noChange: 0,
      nearTarget: 0,
      targetSide: 0
    };

    current.uses += 1;
    current.failingUses += shot.familyFailed ? 1 : 0;
    current.selfSide += shot.visualOutcomeLabel === "self-side-impact" ? 1 : 0;
    current.blocked += shot.visualOutcomeLabel === "blocked" ? 1 : 0;
    current.short += shot.visualOutcomeLabel === "short" ? 1 : 0;
    current.noChange += shot.visualOutcomeLabel === "no-meaningful-visual-change" ? 1 : 0;
    current.nearTarget += shot.visualOutcomeLabel === "near-target" ? 1 : 0;
    current.targetSide += shot.visualOutcomeLabel === "target-side-impact" ? 1 : 0;
    map.set(shot.family, current);
  }

  return map;
}

function inferOpeningFamily(input: {
  attemptStrategy: CatAndDogAttemptStrategy;
  runtime: CatAndDogShotPlannerRuntimeContext;
  seededFamily: CatAndDogShotFamily | null;
}): CatAndDogShotFamily {
  if (input.seededFamily) {
    return input.seededFamily;
  }

  const windMagnitude = Math.abs(input.runtime.windNormalized ?? 0);
  const projectileWeight = input.runtime.projectileWeight ?? 1;
  const gravityMultiplier = input.runtime.projectileGravityMultiplier ?? 1;

  if (
    input.runtime.windDirection === "left" &&
    input.attemptStrategy.angleDirection === "right" &&
    windMagnitude >= 0.35
  ) {
    return "high-arc-anti-headwind";
  }

  if (projectileWeight >= 1.35 || gravityMultiplier >= 1.15) {
    return "high-arc-anti-headwind";
  }

  if (
    input.runtime.windDirection === "right" &&
    input.attemptStrategy.angleDirection === "right" &&
    windMagnitude >= 0.45
  ) {
    return "flatter-tailwind-trim";
  }

  return "medium-arc-default";
}

function chooseRecoveryFamily(input: {
  failedFamily: CatAndDogShotFamily;
  runtime: CatAndDogShotPlannerRuntimeContext;
  label: CatAndDogVisionShotOutcomeLabel;
}): {
  family: CatAndDogShotFamily;
  reason: string;
} {
  const { failedFamily, runtime, label } = input;

  if (failedFamily === "self-side-recovery") {
    return {
      family:
        runtime.windDirection === "left" && Math.abs(runtime.windNormalized ?? 0) >= 0.35
          ? "high-arc-anti-headwind"
          : "medium-arc-default",
      reason: "Repeated self-side recovery shots failed, so abandon recovery and move to a safer carry family."
    };
  }

  if (failedFamily === "blocked-terrain-escape") {
    return {
      family: "high-arc-anti-headwind",
      reason: "Repeated blocked-terrain escapes failed, so switch to a higher-arc carry family."
    };
  }

  if (failedFamily === "near-target-finisher") {
    return {
      family: "medium-arc-default",
      reason: "Repeated finisher shots did not close the round, so fall back to a steadier default family."
    };
  }

  if (label === "blocked") {
    return {
      family: "blocked-terrain-escape",
      reason: "Repeated blocked shots require an explicit terrain-escape family."
    };
  }

  if (label === "self-side-impact") {
    return {
      family: "self-side-recovery",
      reason: "Repeated self-side impacts require an explicit recovery family."
    };
  }

  return {
    family: "medium-arc-default",
    reason: "Recent local family kept failing, so switch to the safest default runtime family."
  };
}

function chooseFamily(input: {
  openingFamily: CatAndDogShotFamily;
  runtime: CatAndDogShotPlannerRuntimeContext;
  shotHistory: readonly CatAndDogShotFeedbackRecord[];
}): {
  family: CatAndDogShotFamily;
  source: CatAndDogShotExecutionPlan["source"];
  familySwitchReason: string | null;
  adaptationReason: string | null;
} {
  const { openingFamily, runtime, shotHistory } = input;
  const lastShot = shotHistory[shotHistory.length - 1] ?? null;

  if (!lastShot) {
    return {
      family: openingFamily,
      source: "attempt-opening",
      familySwitchReason: null,
      adaptationReason: null
    };
  }

  const familyStats = buildFamilyStats(shotHistory);
  const currentStats = familyStats.get(lastShot.family);
  let consecutiveSameFamilyFailures = 0;
  for (const shot of [...shotHistory].reverse()) {
    if (shot.family !== lastShot.family) {
      break;
    }

    if (shot.familyFailed !== true) {
      break;
    }

    consecutiveSameFamilyFailures += 1;
  }
  const repeatedWeakFingerprintCount = shotHistory.filter((shot) => shot.fingerprint === lastShot.fingerprint).length;
  const repeatedWeakFingerprint =
    repeatedWeakFingerprintCount >= 2 &&
    (
      lastShot.visualOutcomeLabel === "self-side-impact" ||
      lastShot.visualOutcomeLabel === "blocked" ||
      lastShot.visualOutcomeLabel === "short" ||
      lastShot.visualOutcomeLabel === "no-meaningful-visual-change"
    );
  const repeatedFamilyFailure =
    currentStats !== undefined &&
    currentStats.failingUses >= 2 &&
    (
      currentStats.selfSide >= 2 ||
      currentStats.blocked >= 2 ||
      currentStats.noChange >= 2
    );
  const exhaustedFamily =
    currentStats !== undefined &&
    currentStats.uses >= 2 &&
    currentStats.failingUses >= 2 &&
    (
      (lastShot.family === "self-side-recovery" && currentStats.selfSide >= 2) ||
      (lastShot.family === "blocked-terrain-escape" && currentStats.blocked >= 2) ||
      (
        lastShot.family === "near-target-finisher" &&
        currentStats.nearTarget >= 2 &&
        currentStats.targetSide === 0
      ) ||
      (
        currentStats.failingUses === currentStats.uses &&
        currentStats.targetSide === 0 &&
        currentStats.nearTarget === 0
      ) ||
      consecutiveSameFamilyFailures >= 3
    );

  if (repeatedFamilyFailure || exhaustedFamily) {
    const switched = chooseRecoveryFamily({
      failedFamily: lastShot.family,
      runtime,
      label: lastShot.visualOutcomeLabel
    });
    return {
      family: switched.family,
      source: "family-abandonment",
      familySwitchReason: switched.reason,
      adaptationReason: [
        exhaustedFamily
          ? `Exhaust ${lastShot.family} after repeated non-productive local use.`
          : `Recent ${lastShot.family} shots kept failing with ${lastShot.visualOutcomeLabel}.`,
        repeatedWeakFingerprint ? "Avoid replaying the same weak shot fingerprint inside the same attempt." : null
      ]
        .filter((part): part is string => Boolean(part))
        .join(" ")
    };
  }

  switch (lastShot.visualOutcomeLabel) {
    case "self-side-impact":
      return {
        family: "self-side-recovery",
        source: "within-attempt-correction",
        familySwitchReason:
          lastShot.family === "self-side-recovery"
            ? null
            : "Last shot stayed on self side, so switch to a recovery family.",
        adaptationReason: "Self-side impact requires a stronger rightward carry."
      };
    case "blocked":
      return {
        family: "blocked-terrain-escape",
        source: "within-attempt-correction",
        familySwitchReason:
          lastShot.family === "blocked-terrain-escape"
            ? null
            : "Last shot looked blocked, so switch to a terrain-escape family.",
        adaptationReason: "Blocked outcome requires a steeper escape profile."
      };
    case "near-target":
      return {
        family: "near-target-finisher",
        source: "finisher",
        familySwitchReason:
          lastShot.family === "near-target-finisher"
            ? null
            : "Last shot landed near target, so switch to a finisher family.",
        adaptationReason: "Near-target feedback supports a narrow finishing adjustment."
      };
    case "target-side-impact":
      return {
        family: "near-target-finisher",
        source: "finisher",
        familySwitchReason:
          lastShot.family === "near-target-finisher"
            ? null
            : "Last shot reached target side, so switch to a finisher family.",
        adaptationReason: "Target-side impact supports tighter local exploitation."
      };
    case "long":
      return {
        family: "flatter-tailwind-trim",
        source: "within-attempt-correction",
        familySwitchReason:
          lastShot.family === "flatter-tailwind-trim"
            ? null
            : "Last shot carried too long, so switch to a flatter trim family.",
        adaptationReason: "Long outcome requires a flatter, lower-power trim."
      };
    case "short":
      return {
        family:
          runtime.windDirection === "left" || (runtime.projectileGravityMultiplier ?? 1) >= 1.1
            ? "high-arc-anti-headwind"
            : "medium-arc-default",
        source: "within-attempt-correction",
        familySwitchReason:
          lastShot.family === "high-arc-anti-headwind" || lastShot.family === "medium-arc-default"
            ? null
            : "Last shot fell short, so switch to a higher-carry family.",
        adaptationReason: "Short outcome requires more carry."
      };
    case "no-meaningful-visual-change":
      return {
        family: openingFamily,
        source: "stability-reset",
        familySwitchReason: null,
        adaptationReason: "Previous shot produced weak visible feedback, so reset to a clearer baseline family."
      };
    default:
      return {
        family: lastShot.family,
        source: "within-attempt-correction",
        familySwitchReason: null,
        adaptationReason: null
      };
  }
}

function resolveWeaponChoice(input: {
  family: CatAndDogShotFamily;
  runtime: CatAndDogShotPlannerRuntimeContext;
  lastShot: CatAndDogShotFeedbackRecord | null;
}): {
  weaponKey: CatAndDogAttemptStrategy["weaponKey"];
  reason: string | null;
} {
  const currentWeapon =
    input.runtime.preparedShotKey === "normal" ||
    input.runtime.preparedShotKey === "light" ||
    input.runtime.preparedShotKey === "heavy" ||
    input.runtime.preparedShotKey === "super" ||
    input.runtime.preparedShotKey === "heal"
      ? input.runtime.preparedShotKey
      : input.runtime.selectedWeaponKey === "normal" ||
          input.runtime.selectedWeaponKey === "light" ||
          input.runtime.selectedWeaponKey === "heavy" ||
          input.runtime.selectedWeaponKey === "super" ||
          input.runtime.selectedWeaponKey === "heal"
        ? input.runtime.selectedWeaponKey
        : input.lastShot?.weaponKey ?? "normal";
  const splashFriendly =
    (input.runtime.projectileSplashRadius ?? 0) >= 60 &&
    (input.runtime.projectileDamageMax ?? 0) >= 18;
  const windSensitive = (input.runtime.projectileWindInfluenceMultiplier ?? 1) >= 1.35;

  if (input.family === "high-arc-anti-headwind" && (currentWeapon === "light" || windSensitive)) {
    return {
      weaponKey: "normal",
      reason: currentWeapon !== "normal" ? "Use Normal for a steadier anti-headwind carry shot." : null
    };
  }

  if (input.family === "self-side-recovery") {
    return {
      weaponKey: "normal",
      reason: currentWeapon !== "normal" ? "Use Normal for steadier self-side recovery." : null
    };
  }

  if (input.family === "blocked-terrain-escape" && splashFriendly && !windSensitive) {
    return {
      weaponKey: "heavy",
      reason: currentWeapon !== "heavy" ? "Use Heavy to clear terrain with safer splash in blocked escape mode." : null
    };
  }

  if (input.family === "near-target-finisher") {
    return {
      weaponKey: "normal",
      reason: currentWeapon !== "normal" ? "Use Normal for a steadier near-target finishing shot." : null
    };
  }

  if (input.family === "flatter-tailwind-trim" && currentWeapon === "heavy") {
    return {
      weaponKey: "normal",
      reason: "Avoid Heavy for flatter tailwind trim to reduce over-carry."
    };
  }

  return {
    weaponKey: currentWeapon,
    reason: null
  };
}

function buildBaseStrategy(input: {
  attemptStrategy: CatAndDogAttemptStrategy;
  runtime: CatAndDogShotPlannerRuntimeContext;
  lastShot: CatAndDogShotFeedbackRecord | null;
  shotNumber: number;
}): CatAndDogAttemptStrategy {
  const preparedAngleTapCount = mapPreparedAngleToTapCount(input.runtime.preparedShotAngle);
  const preparedPowerTapCount = mapPreparedPowerToTapCount(input.runtime.preparedShotPower);
  const previous = input.lastShot;

  return {
    ...input.attemptStrategy,
    attemptNumber: input.attemptStrategy.attemptNumber,
    angleDirection: previous?.angleDirection ?? input.attemptStrategy.angleDirection,
    angleTapCount:
      preparedAngleTapCount === null
        ? previous?.angleTapCount ?? input.attemptStrategy.angleTapCount
        : clampTapCount(
            Math.round(
              ((previous?.angleTapCount ?? input.attemptStrategy.angleTapCount) + preparedAngleTapCount) / 2
            )
          ),
    powerDirection: previous?.powerDirection ?? input.attemptStrategy.powerDirection,
    powerTapCount:
      preparedPowerTapCount === null
        ? previous?.powerTapCount ?? input.attemptStrategy.powerTapCount
        : clampTapCount(
            Math.round(
              ((previous?.powerTapCount ?? input.attemptStrategy.powerTapCount) + preparedPowerTapCount) / 2
            )
          ),
    settleMs: previous ? previous.turnCounterAfter !== null ? input.attemptStrategy.settleMs : input.attemptStrategy.settleMs : input.attemptStrategy.settleMs,
    turnResolutionWaitMs: previous?.shotResolved === false
      ? clampTurnResolutionWaitMs(input.attemptStrategy.turnResolutionWaitMs + 200)
      : input.attemptStrategy.turnResolutionWaitMs
  };
}

function applyFamilyProfile(input: {
  base: CatAndDogAttemptStrategy;
  family: CatAndDogShotFamily;
  runtime: CatAndDogShotPlannerRuntimeContext;
}): CatAndDogAttemptStrategy {
  const { base, family, runtime } = input;
  const windMagnitude = Math.abs(runtime.windNormalized ?? 0);
  const heavyProjectile = (runtime.projectileWeight ?? 1) >= 1.35;
  const highGravityProjectile = (runtime.projectileGravityMultiplier ?? 1) >= 1.15;
  const windSensitive = (runtime.projectileWindInfluenceMultiplier ?? 1) >= 1.35;

  switch (family) {
    case "high-arc-anti-headwind":
      return {
        ...base,
        angleDirection: "right",
        angleTapCount: Math.max(base.angleTapCount, heavyProjectile || highGravityProjectile ? 4 : 3),
        powerDirection: "up",
        powerTapCount: Math.max(base.powerTapCount, windMagnitude >= 0.55 || windSensitive ? 4 : 3),
        settleMs: clampSettleMs(base.settleMs + 20),
        turnResolutionWaitMs: clampTurnResolutionWaitMs(base.turnResolutionWaitMs + 180)
      };
    case "medium-arc-default":
      return {
        ...base,
        angleDirection: "right",
        angleTapCount: clampTapCount(Math.max(2, Math.min(3, base.angleTapCount))),
        powerDirection: "up",
        powerTapCount: clampTapCount(Math.max(2, Math.min(3, base.powerTapCount)))
      };
    case "flatter-tailwind-trim":
      return {
        ...base,
        angleDirection: "right",
        angleTapCount: clampTapCount(Math.min(base.angleTapCount, 2)),
        powerDirection: "up",
        powerTapCount: clampTapCount(Math.max(1, Math.min(3, base.powerTapCount - (windMagnitude >= 0.65 ? 1 : 0)))),
        turnResolutionWaitMs: clampTurnResolutionWaitMs(base.turnResolutionWaitMs - 180)
      };
    case "blocked-terrain-escape":
      return {
        ...base,
        angleDirection: "right",
        angleTapCount: Math.max(base.angleTapCount, heavyProjectile || highGravityProjectile ? 5 : 4),
        powerDirection: "up",
        powerTapCount: Math.max(base.powerTapCount, 4),
        settleMs: clampSettleMs(base.settleMs + 30),
        turnResolutionWaitMs: clampTurnResolutionWaitMs(base.turnResolutionWaitMs + 220)
      };
    case "self-side-recovery":
      return {
        ...base,
        angleDirection: "right",
        angleTapCount: Math.max(base.angleTapCount, 4),
        powerDirection: "up",
        powerTapCount: Math.max(base.powerTapCount, windSensitive ? 4 : 3),
        settleMs: clampSettleMs(base.settleMs + 40)
      };
    case "near-target-finisher":
      return {
        ...base,
        angleDirection: "right",
        angleTapCount: clampTapCount(Math.max(2, Math.min(4, base.angleTapCount))),
        powerDirection: "up",
        powerTapCount: clampTapCount(Math.max(2, Math.min(4, base.powerTapCount))),
        settleMs: clampSettleMs(base.settleMs + 50),
        turnResolutionWaitMs: clampTurnResolutionWaitMs(base.turnResolutionWaitMs + 120)
      };
  }
}

function applyLastShotCorrection(input: {
  strategy: CatAndDogAttemptStrategy;
  runtime: CatAndDogShotPlannerRuntimeContext;
  lastShot: CatAndDogShotFeedbackRecord | null;
  family: CatAndDogShotFamily;
}): {
  strategy: CatAndDogAttemptStrategy;
  reason: string | null;
} {
  const { strategy, runtime, lastShot, family } = input;
  if (!lastShot) {
    return {
      strategy,
      reason: null
    };
  }

  const strongHeadwind =
    runtime.windDirection === "left" &&
    strategy.angleDirection === "right" &&
    Math.abs(runtime.windNormalized ?? 0) >= 0.45;
  const highGravityProjectile = (runtime.projectileGravityMultiplier ?? 1) >= 1.15;
  const windSensitive = (runtime.projectileWindInfluenceMultiplier ?? 1) >= 1.35;
  let next = { ...strategy };
  let reason: string | null = null;

  switch (lastShot.visualOutcomeLabel) {
    case "short":
      next = {
        ...next,
        powerTapCount: clampTapCount(next.powerTapCount + (strongHeadwind || windSensitive ? 2 : 1)),
        angleTapCount: clampTapCount(next.angleTapCount + (highGravityProjectile ? 1 : 0))
      };
      reason = "Last shot looked short, so increase carry.";
      break;
    case "long":
      next = {
        ...next,
        powerTapCount: clampTapCount(next.powerTapCount - 1),
        angleTapCount: clampTapCount(next.angleTapCount - ((runtime.windDirection === "right" && Math.abs(runtime.windNormalized ?? 0) >= 0.45) ? 1 : 0))
      };
      reason = "Last shot looked long, so trim carry.";
      break;
    case "blocked":
      next = {
        ...next,
        angleTapCount: clampTapCount(next.angleTapCount + 2),
        powerTapCount: clampTapCount(next.powerTapCount + (family === "blocked-terrain-escape" ? 1 : 0))
      };
      reason = "Last shot looked blocked, so steepen the escape.";
      break;
    case "self-side-impact":
      next = {
        ...next,
        angleDirection: "right",
        angleTapCount: clampTapCount(next.angleTapCount + 2),
        powerTapCount: clampTapCount(next.powerTapCount + 1)
      };
      reason = "Last shot stayed on self side, so push harder back into the battlefield.";
      break;
    case "near-target":
      next = {
        ...next,
        angleTapCount: clampTapCount(next.angleTapCount + (strongHeadwind ? 1 : 0)),
        powerTapCount: clampTapCount(next.powerTapCount + (strongHeadwind ? 1 : 0))
      };
      reason = "Last shot landed near target, so keep the family and refine tightly.";
      break;
    case "target-side-impact":
      next = {
        ...next,
        settleMs: clampSettleMs(next.settleMs + 20)
      };
      reason = "Last shot reached target side, so keep exploiting the same region.";
      break;
    case "no-meaningful-visual-change":
      next = {
        ...next,
        angleTapCount: clampTapCount(next.angleTapCount + 1),
        powerTapCount: clampTapCount(next.powerTapCount + 1),
        turnResolutionWaitMs: clampTurnResolutionWaitMs(next.turnResolutionWaitMs + 160)
      };
      reason = "Last shot produced weak feedback, so widen the next change slightly.";
      break;
  }

  return {
    strategy: next,
    reason
  };
}

function ensurePlanIsNotWeakRepeat(input: {
  strategy: CatAndDogAttemptStrategy;
  shotHistory: readonly CatAndDogShotFeedbackRecord[];
}): {
  strategy: CatAndDogAttemptStrategy;
  reason: string | null;
} {
  const fingerprint = toFingerprint(input.strategy);
  const repeats = input.shotHistory.filter((shot) => shot.fingerprint === fingerprint);
  const lastRepeat = repeats[repeats.length - 1] ?? null;

  if (!lastRepeat) {
    return {
      strategy: input.strategy,
      reason: null
    };
  }

  const allowExactReplay =
    lastRepeat.visualOutcomeLabel === "near-target" || lastRepeat.visualOutcomeLabel === "target-side-impact";
  if (allowExactReplay && repeats.length === 1) {
    return {
      strategy: input.strategy,
      reason: "Allow one exact replay because the last shot reached a promising target-side region."
    };
  }

  const changed = {
    ...input.strategy,
    powerTapCount:
      lastRepeat.visualOutcomeLabel === "long"
        ? clampTapCount(input.strategy.powerTapCount - 1)
        : clampTapCount(input.strategy.powerTapCount + 1),
    angleTapCount:
      lastRepeat.visualOutcomeLabel === "blocked" || lastRepeat.visualOutcomeLabel === "self-side-impact"
        ? clampTapCount(input.strategy.angleTapCount + 1)
        : input.strategy.angleTapCount
  };

  if (toFingerprint(changed) !== fingerprint) {
    return {
      strategy: changed,
      reason: "Avoid replaying the same weak shot fingerprint again inside the same attempt."
    };
  }

  return {
    strategy: {
      ...input.strategy,
      settleMs: clampSettleMs(input.strategy.settleMs + 30)
    },
    reason: "Avoid replaying the same weak shot fingerprint again inside the same attempt."
  };
}

function buildInputsUsed(input: {
  runtime: CatAndDogShotPlannerRuntimeContext;
  lastShot: CatAndDogShotFeedbackRecord | null;
  familySwitchReason: string | null;
}): readonly string[] {
  const used: string[] = [];

  if (input.runtime.windNormalized !== null) {
    used.push("wind");
  }

  if (input.runtime.projectileWeight !== null || input.runtime.projectileWindInfluenceMultiplier !== null) {
    used.push("projectile-physics");
  }

  if (input.runtime.preparedShotAngle !== null || input.runtime.preparedShotPower !== null) {
    used.push("prepared-shot");
  }

  if (input.lastShot) {
    used.push("last-shot-feedback");
  }

  if (input.familySwitchReason) {
    used.push("family-history");
  }

  return used;
}

export function planCatAndDogShotExecution(input: PlanCatAndDogShotInput): CatAndDogShotExecutionPlan {
  const shotNumber = input.shotHistory.length + 1;
  const lastShot = input.shotHistory[input.shotHistory.length - 1] ?? null;
  const openingFamily = inferOpeningFamily({
    attemptStrategy: input.attemptStrategy,
    runtime: input.runtime,
    seededFamily: input.selectionDetails.plannerFamily
  });
  const familyDecision = chooseFamily({
    openingFamily,
    runtime: input.runtime,
    shotHistory: input.shotHistory
  });
  const base = buildBaseStrategy({
    attemptStrategy: input.attemptStrategy,
    runtime: input.runtime,
    lastShot,
    shotNumber
  });
  const weaponChoice = resolveWeaponChoice({
    family: familyDecision.family,
    runtime: input.runtime,
    lastShot
  });
  let planned = applyFamilyProfile({
    base: {
      ...base,
      weaponKey: weaponChoice.weaponKey
    },
    family: familyDecision.family,
    runtime: input.runtime
  });
  const correction = applyLastShotCorrection({
    strategy: planned,
    runtime: input.runtime,
    lastShot,
    family: familyDecision.family
  });
  planned = correction.strategy;
  const repeatGuard = ensurePlanIsNotWeakRepeat({
    strategy: planned,
    shotHistory: input.shotHistory
  });
  planned = repeatGuard.strategy;

  const source = familyDecision.source;
  const planReasonParts = [
    source === "attempt-opening"
      ? "Use the seeded runtime family for the opening shot."
      : `Use ${familyDecision.family} for the next shot.`,
    familyDecision.familySwitchReason,
    correction.reason,
    repeatGuard.reason,
    weaponChoice.reason
  ].filter((part): part is string => Boolean(part));

  return {
    shotNumber,
    family: familyDecision.family,
    category: toPlannerCategory(familyDecision.family),
    strategy: {
      ...planned,
      weaponKey: weaponChoice.weaponKey
    },
    fingerprint: toFingerprint({
      ...planned,
      weaponKey: weaponChoice.weaponKey
    }),
    source,
    planReason: planReasonParts.join(" "),
    familySwitchReason: familyDecision.familySwitchReason,
    projectilePolicyReason: weaponChoice.reason,
    adaptationReason:
      [familyDecision.adaptationReason, correction.reason, repeatGuard.reason]
        .filter((part): part is string => Boolean(part))
        .join(" ") || null,
    inputsUsed: buildInputsUsed({
      runtime: input.runtime,
      lastShot,
      familySwitchReason: familyDecision.familySwitchReason
    })
  };
}
