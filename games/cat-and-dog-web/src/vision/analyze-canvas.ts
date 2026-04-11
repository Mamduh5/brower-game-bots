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

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
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
    return {
      visionAvailable: false,
      visionChangeRatio: null,
      visionChangeStrength: "unknown",
      visionChangeFocus: "unknown",
      visionImpactCategory: "unknown",
      visionFrameWidth: null,
      visionFrameHeight: null
    };
  }

  if (!previous || previous.width !== current.width || previous.height !== current.height) {
    return {
      visionAvailable: true,
      visionChangeRatio: 0,
      visionChangeStrength: "none",
      visionChangeFocus: "unknown",
      visionImpactCategory: "none",
      visionFrameWidth: current.width,
      visionFrameHeight: current.height
    };
  }

  let sampleCount = 0;
  let changedCount = 0;
  let weightedX = 0;

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

      changedCount += 1;
      weightedX += x;
    }
  }

  const rawChangeRatio = sampleCount > 0 ? changedCount / sampleCount : 0;
  const changeRatio = Number(clampRatio(rawChangeRatio).toFixed(4));

  if (changedCount === 0 || changeRatio < 0.004) {
    return {
      visionAvailable: true,
      visionChangeRatio: changeRatio,
      visionChangeStrength: "none",
      visionChangeFocus: "unknown",
      visionImpactCategory: "none",
      visionFrameWidth: current.width,
      visionFrameHeight: current.height
    };
  }

  const centroidRatio = weightedX / changedCount / current.width;
  const changeFocus =
    centroidRatio < 0.45 ? "left" : centroidRatio > 0.55 ? "right" : "center";
  const changeStrength = changeRatio >= 0.02 ? "strong" : "subtle";
  const visionImpactCategory =
    changeFocus === "right"
      ? "target-side-activity"
      : changeFocus === "left"
        ? "self-side-activity"
        : "terrain-or-midfield-activity";

  return {
    visionAvailable: true,
    visionChangeRatio: changeRatio,
    visionChangeStrength: changeStrength,
    visionChangeFocus: changeFocus,
    visionImpactCategory,
    visionFrameWidth: current.width,
    visionFrameHeight: current.height
  };
}
