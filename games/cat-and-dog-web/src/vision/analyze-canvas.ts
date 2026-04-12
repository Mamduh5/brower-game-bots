import { Buffer } from "node:buffer";

import { PNG } from "pngjs";

export interface CatAndDogVisionState {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CatAndDogVisionSummary {
  readonly visionAvailable: boolean;
  readonly visionChangeRatio: number | null;
  readonly visionChangeStrength: "none" | "subtle" | "strong" | "unknown";
  readonly visionChangeFocus: "left" | "center" | "right" | "unknown";
  readonly visionPlayerAnchorXRatio: number | null;
  readonly visionPlayerAnchorYRatio: number | null;
  readonly visionPlayerAnchorSource: "color-estimate" | "layout-fallback" | "unavailable";
  readonly visionEnemyAnchorXRatio: number | null;
  readonly visionEnemyAnchorYRatio: number | null;
  readonly visionEnemyAnchorSource: "color-estimate" | "layout-fallback" | "unavailable";
  readonly visionImpactXRatio: number | null;
  readonly visionImpactYRatio: number | null;
  readonly visionImpactRegion:
    | "none"
    | "self-side"
    | "short-of-target"
    | "terrain-center"
    | "target-approach"
    | "target-side"
    | "beyond-target"
    | "unknown";
  readonly visionShotOutcomeLabel:
    | "none"
    | "no-meaningful-visual-change"
    | "self-side-impact"
    | "short"
    | "blocked"
    | "near-target"
    | "target-side-impact"
    | "long"
    | "unknown";
  readonly visionShotOutcomeConfidence: "low" | "medium" | "unknown";
  readonly visionShotOutcomeSource: "diff-only" | "anchor-assisted" | "unavailable";
  readonly visionImpactCategory:
    | "none"
    | "target-side-activity"
    | "terrain-or-midfield-activity"
    | "self-side-activity"
    | "unknown";
  readonly visionFrameWidth: number | null;
  readonly visionFrameHeight: number | null;
}

const SAMPLE_STEP = 6;
const PIXEL_DELTA_THRESHOLD = 42;
const MIN_ANCHOR_SAMPLES = 12;
const PLAYER_FALLBACK_ANCHOR = { xRatio: 0.14, yRatio: 0.74 } as const;
const ENEMY_FALLBACK_ANCHOR = { xRatio: 0.84, yRatio: 0.73 } as const;

interface WeightedAnchor {
  readonly xRatio: number;
  readonly yRatio: number;
  readonly source: "color-estimate" | "layout-fallback" | "unavailable";
}

interface DiffEnvelope {
  readonly changeRatio: number;
  readonly changedCount: number;
  readonly centroidXRatio: number | null;
  readonly centroidYRatio: number | null;
  readonly dominantRegion: CatAndDogVisionSummary["visionImpactRegion"];
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function classifyWarmActorPixel(red: number, green: number, blue: number): boolean {
  return (
    red >= 145 &&
    green >= 80 &&
    blue <= 170 &&
    red > blue + 18 &&
    green > blue - 10
  );
}

function classifyCoolActorPixel(red: number, green: number, blue: number): boolean {
  return blue >= 120 && blue > red + 12 && blue > green + 8;
}

function deriveWeightedAnchor(input: {
  frame: CatAndDogVisionState;
  minXRatio: number;
  maxXRatio: number;
  minYRatio: number;
  maxYRatio: number;
  predicate: (red: number, green: number, blue: number) => boolean;
  fallback: { xRatio: number; yRatio: number };
}): WeightedAnchor {
  const minX = Math.floor(input.frame.width * input.minXRatio);
  const maxX = Math.ceil(input.frame.width * input.maxXRatio);
  const minY = Math.floor(input.frame.height * input.minYRatio);
  const maxY = Math.ceil(input.frame.height * input.maxYRatio);
  let sampleCount = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = minY; y < maxY; y += SAMPLE_STEP) {
    for (let x = minX; x < maxX; x += SAMPLE_STEP) {
      const index = (y * input.frame.width + x) * 4;
      const red = input.frame.rgba[index] ?? 0;
      const green = input.frame.rgba[index + 1] ?? 0;
      const blue = input.frame.rgba[index + 2] ?? 0;
      if (!input.predicate(red, green, blue)) {
        continue;
      }

      sampleCount += 1;
      weightedX += x;
      weightedY += y;
    }
  }

  if (sampleCount >= MIN_ANCHOR_SAMPLES) {
    return {
      xRatio: Number(clampRatio(weightedX / sampleCount / input.frame.width).toFixed(4)),
      yRatio: Number(clampRatio(weightedY / sampleCount / input.frame.height).toFixed(4)),
      source: "color-estimate"
    };
  }

  return {
    xRatio: input.fallback.xRatio,
    yRatio: input.fallback.yRatio,
    source: "layout-fallback"
  };
}

function buildEmptySummary(current: CatAndDogVisionState | null): CatAndDogVisionSummary {
  return {
    visionAvailable: current !== null,
    visionChangeRatio: current ? 0 : null,
    visionChangeStrength: current ? "none" : "unknown",
    visionChangeFocus: "unknown",
    visionPlayerAnchorXRatio: current ? PLAYER_FALLBACK_ANCHOR.xRatio : null,
    visionPlayerAnchorYRatio: current ? PLAYER_FALLBACK_ANCHOR.yRatio : null,
    visionPlayerAnchorSource: current ? "layout-fallback" : "unavailable",
    visionEnemyAnchorXRatio: current ? ENEMY_FALLBACK_ANCHOR.xRatio : null,
    visionEnemyAnchorYRatio: current ? ENEMY_FALLBACK_ANCHOR.yRatio : null,
    visionEnemyAnchorSource: current ? "layout-fallback" : "unavailable",
    visionImpactXRatio: null,
    visionImpactYRatio: null,
    visionImpactRegion: current ? "none" : "unknown",
    visionShotOutcomeLabel: current ? "none" : "unknown",
    visionShotOutcomeConfidence: current ? "low" : "unknown",
    visionShotOutcomeSource: current ? "unavailable" : "unavailable",
    visionImpactCategory: current ? "none" : "unknown",
    visionFrameWidth: current?.width ?? null,
    visionFrameHeight: current?.height ?? null
  };
}

function summarizeDiffEnvelope(
  current: CatAndDogVisionState,
  previous: CatAndDogVisionState
): DiffEnvelope {
  let sampleCount = 0;
  let changedCount = 0;
  let totalChangeWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let selfSideWeight = 0;
  let shortWeight = 0;
  let terrainWeight = 0;
  let targetApproachWeight = 0;
  let targetSideWeight = 0;
  let beyondTargetWeight = 0;

  for (let y = 0; y < current.height; y += SAMPLE_STEP) {
    for (let x = 0; x < current.width; x += SAMPLE_STEP) {
      const index = (y * current.width + x) * 4;
      const redDelta = Math.abs((current.rgba[index] ?? 0) - (previous.rgba[index] ?? 0));
      const greenDelta = Math.abs((current.rgba[index + 1] ?? 0) - (previous.rgba[index + 1] ?? 0));
      const blueDelta = Math.abs((current.rgba[index + 2] ?? 0) - (previous.rgba[index + 2] ?? 0));
      sampleCount += 1;

      if (redDelta + greenDelta + blueDelta < PIXEL_DELTA_THRESHOLD) {
        continue;
      }

      const changeWeight = redDelta + greenDelta + blueDelta;
      changedCount += 1;
      totalChangeWeight += changeWeight;
      weightedX += x * changeWeight;
      weightedY += y * changeWeight;
      const xRatio = x / current.width;

      if (xRatio < 0.24) {
        selfSideWeight += changeWeight;
      } else if (xRatio < 0.42) {
        shortWeight += changeWeight;
      } else if (xRatio < 0.6) {
        terrainWeight += changeWeight;
      } else if (xRatio < 0.72) {
        targetApproachWeight += changeWeight;
      } else if (xRatio < 0.9) {
        targetSideWeight += changeWeight;
      } else {
        beyondTargetWeight += changeWeight;
      }
    }
  }

  const rawChangeRatio = sampleCount > 0 ? changedCount / sampleCount : 0;
  const changeRatio = Number(clampRatio(rawChangeRatio).toFixed(4));
  if (changedCount === 0 || changeRatio < 0.004) {
    return {
      changeRatio,
      changedCount,
      centroidXRatio: null,
      centroidYRatio: null,
      dominantRegion: "none"
    };
  }

  const regionCounts: Array<[CatAndDogVisionSummary["visionImpactRegion"], number]> = [
    ["self-side", selfSideWeight],
    ["short-of-target", shortWeight],
    ["terrain-center", terrainWeight],
    ["target-approach", targetApproachWeight],
    ["target-side", targetSideWeight],
    ["beyond-target", beyondTargetWeight]
  ];
  regionCounts.sort((left, right) => right[1] - left[1]);
  const dominantRegion = regionCounts[0]?.[1] ? regionCounts[0][0] : "unknown";

  return {
    changeRatio,
    changedCount,
    centroidXRatio: Number(clampRatio(weightedX / totalChangeWeight / current.width).toFixed(4)),
    centroidYRatio: Number(clampRatio(weightedY / totalChangeWeight / current.height).toFixed(4)),
    dominantRegion,
  };
}

function distanceBetweenRatios(
  point: { xRatio: number; yRatio: number },
  target: { xRatio: number; yRatio: number }
): number {
  return Math.hypot(point.xRatio - target.xRatio, point.yRatio - target.yRatio);
}

function classifyImpactCategory(
  impactRegion: CatAndDogVisionSummary["visionImpactRegion"],
  shotOutcomeLabel: CatAndDogVisionSummary["visionShotOutcomeLabel"]
): CatAndDogVisionSummary["visionImpactCategory"] {
  if (shotOutcomeLabel === "none" || shotOutcomeLabel === "no-meaningful-visual-change") {
    return "none";
  }

  if (shotOutcomeLabel === "self-side-impact") {
    return "self-side-activity";
  }

  if (shotOutcomeLabel === "near-target" || shotOutcomeLabel === "target-side-impact" || shotOutcomeLabel === "long") {
    return "target-side-activity";
  }

  if (
    shotOutcomeLabel === "blocked" ||
    shotOutcomeLabel === "short" ||
    impactRegion === "terrain-center" ||
    impactRegion === "target-approach"
  ) {
    return "terrain-or-midfield-activity";
  }

  return "unknown";
}

function classifyShotOutcome(input: {
  changeStrength: CatAndDogVisionSummary["visionChangeStrength"];
  diff: DiffEnvelope;
  playerAnchor: WeightedAnchor;
  enemyAnchor: WeightedAnchor;
}): {
  label: CatAndDogVisionSummary["visionShotOutcomeLabel"];
  confidence: CatAndDogVisionSummary["visionShotOutcomeConfidence"];
  source: CatAndDogVisionSummary["visionShotOutcomeSource"];
} {
  if (input.diff.dominantRegion === "none") {
    return {
      label: "no-meaningful-visual-change",
      confidence: "low",
      source: "diff-only"
    };
  }

  if (input.diff.centroidXRatio === null || input.diff.centroidYRatio === null) {
    return {
      label: "unknown",
      confidence: "unknown",
      source: "unavailable"
    };
  }

  const impactPoint = {
    xRatio: input.diff.centroidXRatio,
    yRatio: input.diff.centroidYRatio
  };
  const enemyDistance = distanceBetweenRatios(impactPoint, {
    xRatio: input.enemyAnchor.xRatio,
    yRatio: input.enemyAnchor.yRatio
  });
  const usingAnchorAssist =
    input.playerAnchor.source !== "unavailable" && input.enemyAnchor.source !== "unavailable";
  const confidence =
    usingAnchorAssist && input.changeStrength === "strong" ? "medium" : "low";
  const source = usingAnchorAssist ? "anchor-assisted" : "diff-only";

  if (
    input.diff.dominantRegion === "self-side" ||
    impactPoint.xRatio <= Math.min(0.3, input.playerAnchor.xRatio + 0.08)
  ) {
    return {
      label: "self-side-impact",
      confidence,
      source
    };
  }

  if (
    input.diff.dominantRegion === "terrain-center" &&
    impactPoint.yRatio >= 0.48
  ) {
    return {
      label: "blocked",
      confidence,
      source
    };
  }

  if (enemyDistance <= 0.12) {
    return {
      label: "near-target",
      confidence,
      source
    };
  }

  if (impactPoint.xRatio > input.enemyAnchor.xRatio + 0.1 || input.diff.dominantRegion === "beyond-target") {
    return {
      label: "long",
      confidence,
      source
    };
  }

  if (
    impactPoint.xRatio < input.enemyAnchor.xRatio - 0.18 &&
    (
      input.diff.dominantRegion === "short-of-target" ||
      input.diff.dominantRegion === "terrain-center" ||
      input.diff.dominantRegion === "target-approach"
    )
  ) {
    return {
      label: "short",
      confidence,
      source
    };
  }

  if (
    input.diff.dominantRegion === "target-side" ||
    input.diff.dominantRegion === "target-approach"
  ) {
    return {
      label: "target-side-impact",
      confidence,
      source
    };
  }

  return {
    label: "unknown",
    confidence,
    source
  };
}

export function parseCatAndDogVisionFrame(base64Png: string | null | undefined): CatAndDogVisionState | null {
  if (!base64Png || typeof base64Png !== "string") {
    return null;
  }

  try {
    const png = PNG.sync.read(Buffer.from(base64Png, "base64"));
    return {
      width: png.width,
      height: png.height,
      rgba: png.data
    };
  } catch {
    return null;
  }
}

export function summarizeCatAndDogVision(
  current: CatAndDogVisionState | null,
  previous: CatAndDogVisionState | null
): CatAndDogVisionSummary {
  if (!current) {
    return buildEmptySummary(null);
  }

  const playerAnchor = deriveWeightedAnchor({
    frame: current,
    minXRatio: 0.03,
    maxXRatio: 0.32,
    minYRatio: 0.52,
    maxYRatio: 0.92,
    predicate: classifyWarmActorPixel,
    fallback: PLAYER_FALLBACK_ANCHOR
  });
  const enemyAnchor = deriveWeightedAnchor({
    frame: current,
    minXRatio: 0.66,
    maxXRatio: 0.96,
    minYRatio: 0.48,
    maxYRatio: 0.92,
    predicate: classifyCoolActorPixel,
    fallback: ENEMY_FALLBACK_ANCHOR
  });

  if (!previous || previous.width !== current.width || previous.height !== current.height) {
    return {
      ...buildEmptySummary(current),
      visionPlayerAnchorXRatio: playerAnchor.xRatio,
      visionPlayerAnchorYRatio: playerAnchor.yRatio,
      visionPlayerAnchorSource: playerAnchor.source,
      visionEnemyAnchorXRatio: enemyAnchor.xRatio,
      visionEnemyAnchorYRatio: enemyAnchor.yRatio,
      visionEnemyAnchorSource: enemyAnchor.source,
      visionFrameWidth: current.width,
      visionFrameHeight: current.height
    };
  }

  const diff = summarizeDiffEnvelope(current, previous);
  const changeStrength =
    diff.dominantRegion === "none" ? "none" : diff.changeRatio >= 0.02 ? "strong" : "subtle";
  const changeFocus =
    diff.centroidXRatio === null
      ? "unknown"
      : diff.centroidXRatio < 0.45
        ? "left"
        : diff.centroidXRatio > 0.55
          ? "right"
          : "center";
  const shotOutcome = classifyShotOutcome({
    changeStrength,
    diff,
    playerAnchor,
    enemyAnchor
  });
  const visionImpactCategory = classifyImpactCategory(diff.dominantRegion, shotOutcome.label);

  return {
    visionAvailable: true,
    visionChangeRatio: diff.changeRatio,
    visionChangeStrength: changeStrength,
    visionChangeFocus: changeFocus,
    visionPlayerAnchorXRatio: playerAnchor.xRatio,
    visionPlayerAnchorYRatio: playerAnchor.yRatio,
    visionPlayerAnchorSource: playerAnchor.source,
    visionEnemyAnchorXRatio: enemyAnchor.xRatio,
    visionEnemyAnchorYRatio: enemyAnchor.yRatio,
    visionEnemyAnchorSource: enemyAnchor.source,
    visionImpactXRatio: diff.centroidXRatio,
    visionImpactYRatio: diff.centroidYRatio,
    visionImpactRegion: diff.dominantRegion,
    visionShotOutcomeLabel: shotOutcome.label,
    visionShotOutcomeConfidence: shotOutcome.confidence,
    visionShotOutcomeSource: shotOutcome.source,
    visionImpactCategory,
    visionFrameWidth: current.width,
    visionFrameHeight: current.height
  };
}
