import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface DiscoveredRunSummary {
  readonly runId: string | null;
  readonly gameId: string | null;
  readonly profileId: string | null;
  readonly requestedDifficulty: string | null;
  readonly runtimeDifficulty: string | null;
  readonly attemptCount: number;
  readonly hadWin: boolean | null;
  readonly sourcePath: string;
  readonly relativeSourcePath: string;
  readonly updatedAt: string | null;
}

export interface NormalizedRunSummary extends DiscoveredRunSummary {
  readonly maxAttempts: number | null;
  readonly stopOnWin: boolean | null;
  readonly strategyMode: string | null;
  readonly attempts: readonly NormalizedAttempt[];
  readonly artifactPaths: readonly string[];
  readonly screenshotPaths: readonly string[];
  readonly raw: JsonRecord;
}

export interface NormalizedAttempt {
  readonly attemptNumber: number | null;
  readonly outcome: string | null;
  readonly assessment: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly note: string | null;
  readonly requestedDifficulty: string | null;
  readonly runtimeDifficulty: string | null;
  readonly selectedWeapon: string | null;
  readonly plannedWeapon: string | null;
  readonly plannedTargetAngle: number | null;
  readonly plannedTargetPower: number | null;
  readonly preparedAngle: number | null;
  readonly preparedPower: number | null;
  readonly preparedWeapon: string | null;
  readonly playerHp: number | null;
  readonly cpuHp: number | null;
  readonly playerHpStart: number | null;
  readonly cpuHpStart: number | null;
  readonly damageDealt: number | null;
  readonly damageTaken: number | null;
  readonly wind: NormalizedWind;
  readonly wall: NormalizedWall;
  readonly finalNote: string | null;
  readonly endTitle: string | null;
  readonly plannerReason: string | null;
  readonly adaptationReason: string | null;
  readonly actionCount: number;
  readonly shotCount: number;
  readonly actionHistory: readonly JsonRecord[];
  readonly shotHistory: readonly NormalizedShot[];
  readonly artifactPaths: readonly string[];
  readonly screenshotPaths: readonly string[];
  readonly diagnostics: JsonRecord;
  readonly strategySelectionDetails: JsonRecord;
  readonly finalState: JsonRecord;
}

export interface NormalizedShot {
  readonly shotNumber: number | null;
  readonly plannedAt: string | null;
  readonly resolvedAt: string | null;
  readonly family: string | null;
  readonly category: string | null;
  readonly source: string | null;
  readonly selectedWeapon: string | null;
  readonly plannedWeapon: string | null;
  readonly plannedTargetAngle: number | null;
  readonly plannedTargetPower: number | null;
  readonly angleDirection: string | null;
  readonly angleTapCount: number | null;
  readonly powerDirection: string | null;
  readonly powerTapCount: number | null;
  readonly damageDealt: number | null;
  readonly damageTaken: number | null;
  readonly hitCategory: string | null;
  readonly shotResolution: string | null;
  readonly hintCategory: string | null;
  readonly hintText: string | null;
  readonly outcomeAfterShot: string | null;
  readonly plannerReason: string | null;
  readonly adaptationReason: string | null;
  readonly familySwitchReason: string | null;
  readonly fingerprint: string | null;
}

export interface NormalizedWind {
  readonly value: number | null;
  readonly direction: string | null;
  readonly normalized: number | null;
}

export interface NormalizedWall {
  readonly hp: number | null;
  readonly destroyed: boolean | null;
}

type JsonRecord = Record<string, unknown>;

const PLAYER_SUMMARY_FILE = "02-player-attempt-summary.json";

export async function discoverCatAndDogSummaries(repoRoot: string): Promise<DiscoveredRunSummary[]> {
  const artifactsRoot = path.join(repoRoot, "artifacts");
  const summaryPaths = await findSummaryFiles(artifactsRoot);
  const summaries = await Promise.all(
    summaryPaths.map(async (summaryPath) => {
      const normalized = await loadCatAndDogSummary(repoRoot, summaryPath);
      return toDiscoveredRunSummary(normalized);
    })
  );

  return summaries.sort((left, right) => compareUpdatedAtDesc(left.updatedAt, right.updatedAt));
}

export async function loadCatAndDogSummary(repoRoot: string, summaryPath: string): Promise<NormalizedRunSummary> {
  const resolvedPath = resolveSummaryPath(repoRoot, summaryPath);
  const raw = await readJsonRecord(resolvedPath);
  return normalizeRunSummary(raw, resolvedPath, repoRoot);
}

export function resolveSummaryPath(repoRoot: string, summaryPath: string): string {
  const resolvedPath = path.resolve(repoRoot, summaryPath);
  assertInside(repoRoot, resolvedPath);
  return resolvedPath;
}

export function resolveArtifactPath(repoRoot: string, artifactPath: string): string {
  const artifactsRoot = path.join(repoRoot, "artifacts");
  const resolvedPath = path.resolve(artifactsRoot, artifactPath);
  assertInside(artifactsRoot, resolvedPath);
  return resolvedPath;
}

function normalizeRunSummary(raw: JsonRecord, sourcePath: string, repoRoot: string): NormalizedRunSummary {
  const run = recordAt(raw, "run");
  const summary = recordAt(raw, "summary");
  const attempts = arrayAt(raw, "attempts").map(normalizeAttempt);
  const artifactPaths = collectArtifactPaths(arrayAt(raw, "artifacts"));
  const screenshotPaths = artifactPaths.filter(isScreenshotPath);

  return {
    runId: stringAt(run, "runId") ?? stringAt(raw, "runId") ?? inferRunId(sourcePath),
    gameId: stringAt(run, "gameId") ?? stringAt(raw, "gameId"),
    profileId: stringAt(run, "profileId") ?? stringAt(raw, "profileId"),
    requestedDifficulty: stringAt(summary, "requestedDifficulty") ?? stringAt(raw, "requestedDifficulty"),
    runtimeDifficulty:
      stringAt(summary, "runtimeCpuDifficulty") ?? attempts.find((attempt) => attempt.runtimeDifficulty)?.runtimeDifficulty ?? null,
    maxAttempts: numberAt(summary, "maxAttempts") ?? numberAt(raw, "maxAttempts"),
    stopOnWin: booleanAt(summary, "stopOnWin") ?? booleanAt(raw, "stopOnWin"),
    strategyMode: stringAt(summary, "strategyMode") ?? stringAt(raw, "strategyMode"),
    attemptCount: numberAt(summary, "attemptsRun") ?? attempts.length,
    hadWin: booleanAt(summary, "hadWin") ?? (attempts.some((attempt) => attempt.outcome === "WIN") ? true : null),
    sourcePath,
    relativeSourcePath: path.relative(repoRoot, sourcePath),
    updatedAt: stringAt(run, "updatedAt") ?? stringAt(raw, "updatedAt"),
    attempts,
    artifactPaths,
    screenshotPaths,
    raw
  };
}

function normalizeAttempt(value: unknown): NormalizedAttempt {
  const attempt = asRecord(value);
  const strategy = recordAt(attempt, "strategy");
  const diagnostics = recordAt(attempt, "diagnostics");
  const details = recordAt(attempt, "strategySelectionDetails");
  const finalState = recordAt(attempt, "finalState");
  const finalLiveRuntimeState = recordAt(finalState, "finalLiveRuntimeState");
  const lastKnownGoodRuntimeState = recordAt(finalState, "lastKnownGoodRuntimeState");
  const shotHistory = arrayAt(attempt, "shotHistory").map(normalizeShot);
  const artifactPaths = collectArtifactPaths(arrayAt(attempt, "artifacts"));

  return {
    attemptNumber: numberAt(attempt, "attemptNumber"),
    outcome: stringAt(attempt, "outcome"),
    assessment: stringAt(attempt, "assessment"),
    startedAt: stringAt(attempt, "startedAt"),
    endedAt: stringAt(attempt, "endedAt"),
    note: stringAt(attempt, "note"),
    requestedDifficulty: stringAt(attempt, "requestedDifficulty") ?? stringAt(strategy, "difficulty"),
    runtimeDifficulty:
      stringAt(attempt, "runtimeCpuDifficulty") ??
      stringAt(finalState, "cpuDifficulty") ??
      stringAt(finalLiveRuntimeState, "cpuDifficulty") ??
      stringAt(lastKnownGoodRuntimeState, "cpuDifficulty"),
    selectedWeapon: stringAt(finalState, "selectedWeaponKey"),
    plannedWeapon: stringAt(strategy, "weaponKey") ?? stringAt(recordAt(details, "plannerIntent"), "weaponKey"),
    plannedTargetAngle: numberAt(strategy, "targetAngle") ?? numberAt(recordAt(details, "plannerIntent"), "targetAngle"),
    plannedTargetPower: numberAt(strategy, "targetPower") ?? numberAt(recordAt(details, "plannerIntent"), "targetPower"),
    preparedAngle: numberAt(finalState, "preparedShotAngle") ?? numberAt(diagnostics, "preparedShotAngle"),
    preparedPower: numberAt(finalState, "preparedShotPower") ?? numberAt(diagnostics, "preparedShotPower"),
    preparedWeapon: stringAt(finalState, "preparedShotKey") ?? stringAt(diagnostics, "preparedShotKey"),
    playerHp: numberAt(finalState, "runtimePlayerHp") ?? numberAt(finalState, "playerHpValue") ?? numberAt(diagnostics, "playerHpEnd"),
    cpuHp: numberAt(finalState, "runtimeCpuHp") ?? numberAt(finalState, "cpuHpValue") ?? numberAt(diagnostics, "cpuHpEnd"),
    playerHpStart: numberAt(diagnostics, "playerHpStart"),
    cpuHpStart: numberAt(diagnostics, "cpuHpStart"),
    damageDealt: numberAt(diagnostics, "damageDealt"),
    damageTaken: numberAt(diagnostics, "damageTaken"),
    wind: {
      value: numberAt(finalState, "windValue") ?? numberAt(diagnostics, "windValue"),
      direction: stringAt(finalState, "windDirection") ?? stringAt(diagnostics, "windDirection"),
      normalized: numberAt(finalState, "windNormalized") ?? numberAt(diagnostics, "windNormalized")
    },
    wall: {
      hp: numberAt(finalState, "wallHp"),
      destroyed: booleanAt(finalState, "wallDestroyed")
    },
    finalNote: stringAt(finalState, "endSubtitleText") ?? stringAt(finalState, "matchNoteText") ?? stringAt(attempt, "note"),
    endTitle: stringAt(finalState, "endTitleText") ?? stringAt(attempt, "note"),
    plannerReason: stringAt(details, "plannerReason") ?? stringAt(attempt, "strategySelectionReason"),
    adaptationReason: firstText([
      stringAt(details, "expectedMutationReason"),
      ...shotHistory.map((shot) => shot.adaptationReason)
    ]),
    actionCount: arrayAt(attempt, "actionHistory").length,
    shotCount: shotHistory.length,
    actionHistory: arrayAt(attempt, "actionHistory").map(asRecord),
    shotHistory,
    artifactPaths,
    screenshotPaths: artifactPaths.filter(isScreenshotPath),
    diagnostics,
    strategySelectionDetails: details,
    finalState
  };
}

function normalizeShot(value: unknown): NormalizedShot {
  const shot = asRecord(value);
  const strategy = recordAt(shot, "strategy");
  const feedback = recordAt(shot, "feedback");

  return {
    shotNumber: numberAt(shot, "shotNumber"),
    plannedAt: stringAt(shot, "plannedAt"),
    resolvedAt: stringAt(shot, "resolvedAt"),
    family: stringAt(shot, "family"),
    category: stringAt(shot, "category"),
    source: stringAt(shot, "source"),
    selectedWeapon: stringAt(strategy, "weaponKey"),
    plannedWeapon: stringAt(strategy, "weaponKey"),
    plannedTargetAngle: numberAt(strategy, "targetAngle"),
    plannedTargetPower: numberAt(strategy, "targetPower"),
    angleDirection: stringAt(strategy, "angleDirection"),
    angleTapCount: numberAt(strategy, "angleTapCount"),
    powerDirection: stringAt(strategy, "powerDirection"),
    powerTapCount: numberAt(strategy, "powerTapCount"),
    damageDealt: numberAt(feedback, "damageDealtDelta"),
    damageTaken: numberAt(feedback, "damageTakenDelta"),
    hitCategory: stringAt(feedback, "visualOutcomeLabel"),
    shotResolution: stringAt(feedback, "shotResolutionCategory"),
    hintCategory: stringAt(feedback, "hintCategory"),
    hintText: stringAt(feedback, "hintText"),
    outcomeAfterShot: stringAt(feedback, "outcomeAfterShot"),
    plannerReason: stringAt(shot, "projectilePolicyReason"),
    adaptationReason: stringAt(shot, "adaptationReason"),
    familySwitchReason: stringAt(shot, "familySwitchReason"),
    fingerprint: stringAt(shot, "fingerprint")
  };
}

function toDiscoveredRunSummary(summary: NormalizedRunSummary): DiscoveredRunSummary {
  return {
    runId: summary.runId,
    gameId: summary.gameId,
    profileId: summary.profileId,
    requestedDifficulty: summary.requestedDifficulty,
    runtimeDifficulty: summary.runtimeDifficulty,
    attemptCount: summary.attemptCount,
    hadWin: summary.hadWin,
    sourcePath: summary.sourcePath,
    relativeSourcePath: summary.relativeSourcePath,
    updatedAt: summary.updatedAt
  };
}

async function findSummaryFiles(root: string): Promise<string[]> {
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findSummaryFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name === PLAYER_SUMMARY_FILE) {
      found.push(entryPath);
    }
  }
  return found;
}

async function readJsonRecord(filePath: string): Promise<JsonRecord> {
  const content = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(content);
  return asRecord(parsed);
}

function collectArtifactPaths(artifacts: readonly unknown[]): string[] {
  return artifacts.map((artifact) => stringAt(asRecord(artifact), "relativePath")).filter((value): value is string => value !== null);
}

function isScreenshotPath(value: string): boolean {
  return value.toLowerCase().endsWith(".png") || value.toLowerCase().includes("/screenshots/");
}

function inferRunId(summaryPath: string): string | null {
  const reportsDir = path.dirname(summaryPath);
  const runDir = path.dirname(reportsDir);
  return path.basename(runDir) || null;
}

function compareUpdatedAtDesc(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return rightTime - leftTime;
}

function assertInside(root: string, target: string): void {
  const relativePath = path.relative(root, target);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside the repository: ${target}`);
  }
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function recordAt(record: JsonRecord, key: string): JsonRecord {
  return asRecord(record[key]);
}

function arrayAt(record: JsonRecord, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringAt(record: JsonRecord, key: string): string | null {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

function numberAt(record: JsonRecord, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function booleanAt(record: JsonRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function firstText(values: readonly (string | null)[]): string | null {
  return values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null;
}

