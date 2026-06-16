import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import initSqlJs, { type SqlJsStatic } from "sql.js";

import {
  getSummaryRelativePathForRun,
  loadCatAndDogSummaryByRunId,
  normalizeAttempt,
  normalizeShot,
  type NormalizedAttempt,
  type NormalizedRunSummary,
  type NormalizedShot
} from "./summary-loader.js";

export type CatAndDogDifficulty = "easy" | "normal" | "hard" | "impossible";
export type CatAndDogStrategyMode = "baseline" | "explore";
export type LiveRunStatus = "starting" | "running" | "stopping" | "stopped" | "completed" | "failed";

export interface StartBotRunRequest {
  readonly difficulty: CatAndDogDifficulty;
  readonly maxAttempts: number;
  readonly strategyMode: CatAndDogStrategyMode;
  readonly stopOnWin: boolean;
}

export interface LiveRunState {
  readonly botRunId: string;
  readonly cliRunId: string | null;
  readonly status: LiveRunStatus;
  readonly phase: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly settings: StartBotRunRequest;
  readonly command: readonly string[];
  readonly currentAttemptNumber: number | null;
  readonly latestAction: JsonRecord | null;
  readonly latestShotPlan: JsonRecord | null;
  readonly latestObservation: LiveObservation | null;
  readonly latestAttempt: NormalizedAttempt | null;
  readonly shotHistory: readonly NormalizedShot[];
  readonly latestScreenshotPath: string | null;
  readonly latestScreenshotUrl: string | null;
  readonly summaryPath: string | null;
  readonly summary: NormalizedRunSummary | null;
  readonly stdoutTail: readonly string[];
  readonly stderrTail: readonly string[];
  readonly error: string | null;
}

export interface LiveObservation {
  readonly status: string | null;
  readonly selectedWeapon: string | null;
  readonly preparedAngle: number | null;
  readonly preparedPower: number | null;
  readonly currentAngle: number | null;
  readonly currentPower: number | null;
  readonly playerHp: number | null;
  readonly cpuHp: number | null;
  readonly windValue: number | null;
  readonly windDirection: string | null;
  readonly windNormalized: number | null;
  readonly wallHp: number | null;
  readonly wallDestroyed: boolean | null;
  readonly outcome: string | null;
  readonly endTitle: string | null;
}

type JsonRecord = Record<string, unknown>;

interface RunProcess {
  readonly botRunId: string;
  cliRunId: string | null;
  status: LiveRunStatus;
  phase: string | null;
  readonly startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  readonly settings: StartBotRunRequest;
  readonly command: readonly string[];
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdoutTail: string[];
  readonly stderrTail: string[];
  error: string | null;
  killTimer: NodeJS.Timeout | null;
  maxRuntimeTimer: NodeJS.Timeout | null;
}

const MAX_TAIL_LINES = 160;
const MAX_RUNTIME_MS = 30 * 60 * 1000;

export class BotRunManager {
  private readonly runs = new Map<string, RunProcess>();
  private readonly sqlPromise: Promise<SqlJsStatic>;

  constructor(private readonly repoRoot: string) {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    this.sqlPromise = initSqlJs({
      locateFile: () => wasmPath
    });
  }

  start(settings: StartBotRunRequest): LiveRunState {
    const active = [...this.runs.values()].find((run) => run.status === "starting" || run.status === "running");
    if (active) {
      throw new Error(`A bot run is already active: ${active.botRunId}`);
    }

    const normalizedSettings = normalizeStartRequest(settings);
    const botRunId = randomUUID();
    const startedAt = new Date().toISOString();
    const cliArgs = [
      "run-player-cat-and-dog",
      `--difficulty=${normalizedSettings.difficulty}`,
      `--max-attempts=${normalizedSettings.maxAttempts}`,
      `--strategy-mode=${normalizedSettings.strategyMode}`,
      `--stop-on-win=${normalizedSettings.stopOnWin ? "true" : "false"}`
    ];
    const spawnSpec = buildSpawnSpec(cliArgs);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        FORCE_COLOR: "0"
      },
      windowsHide: true
    });
    const run: RunProcess = {
      botRunId,
      cliRunId: null,
      status: "starting",
      phase: "starting",
      startedAt,
      endedAt: null,
      exitCode: null,
      signal: null,
      settings: normalizedSettings,
      command: spawnSpec.displayCommand,
      child,
      stdoutTail: [],
      stderrTail: [],
      error: null,
      killTimer: null,
      maxRuntimeTimer: null
    };

    this.runs.set(botRunId, run);
    attachLineReader(child.stdout, (line) => this.handleOutputLine(run, line, "stdout"));
    attachLineReader(child.stderr, (line) => this.handleOutputLine(run, line, "stderr"));

    child.on("spawn", () => {
      run.status = "running";
      run.phase = "process-started";
    });
    child.on("error", (error) => {
      run.status = "failed";
      run.error = error.message;
      run.endedAt = new Date().toISOString();
    });
    child.on("exit", (code, signal) => {
      run.exitCode = code;
      run.signal = signal;
      run.endedAt = new Date().toISOString();
      if (run.maxRuntimeTimer) {
        clearTimeout(run.maxRuntimeTimer);
      }
      if (run.status === "stopping") {
        run.status = "stopped";
        run.phase = "stopped";
        return;
      }
      run.status = code === 0 ? "completed" : "failed";
      run.phase = code === 0 ? "completed" : "failed";
      if (code !== 0 && !run.error) {
        run.error = `Bot process exited with code ${code ?? "null"}${signal ? ` and signal ${signal}` : ""}.`;
      }
    });

    run.maxRuntimeTimer = setTimeout(() => {
      run.error = `Run exceeded ${Math.round(MAX_RUNTIME_MS / 60000)} minute local GUI safety timeout.`;
      void this.stop(botRunId);
    }, MAX_RUNTIME_MS);

    return this.buildState(run, null, null, [], null);
  }

  async stop(id: string): Promise<LiveRunState> {
    const run = this.findRun(id);
    if (!run) {
      throw new Error(`Unknown bot run: ${id}`);
    }

    if (run.status !== "starting" && run.status !== "running") {
      return this.getLiveState(id);
    }

    run.status = "stopping";
    run.phase = "stopping";

    if (process.platform === "win32") {
      await killWindowsProcessTree(run.child.pid);
    } else {
      run.child.kill("SIGTERM");
      run.killTimer = setTimeout(() => {
        if (!run.child.killed) {
          run.child.kill("SIGKILL");
        }
      }, 3000);
    }

    return this.getLiveState(id);
  }

  async getLiveState(id: string): Promise<LiveRunState> {
    const run = this.findRun(id);
    if (!run) {
      throw new Error(`Unknown bot run: ${id}`);
    }
    const events = run.cliRunId ? await this.readRunEvents(run.cliRunId) : [];
    const summary = run.cliRunId ? await tryLoadSummary(this.repoRoot, run.cliRunId) : null;
    const screenshots = run.cliRunId ? await discoverScreenshotPaths(this.repoRoot, run.cliRunId) : [];
    return this.buildState(run, summary, deriveEventState(events), screenshots, run.error);
  }

  getAllRuns(): readonly RunProcess[] {
    return [...this.runs.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  findRun(id: string): RunProcess | null {
    return [...this.runs.values()].find((run) => run.botRunId === id || run.cliRunId === id) ?? null;
  }

  private handleOutputLine(run: RunProcess, line: string, stream: "stdout" | "stderr"): void {
    pushTail(stream === "stdout" ? run.stdoutTail : run.stderrTail, line);
    const parsed = parseJsonLine(line);
    if (parsed) {
      const lineRunId = readString(parsed, "runId");
      if (lineRunId && !run.cliRunId) {
        run.cliRunId = lineRunId;
      }
      const eventType = readString(parsed, "eventType");
      if (eventType) {
        run.phase = eventType;
      }
      const message = readString(parsed, "msg");
      if (message?.includes("Starting cat-and-dog player run")) {
        run.status = "running";
      }
      return;
    }

    const completedMatch = line.match(/Completed cat-and-dog player run ([0-9a-f-]+)/i);
    if (completedMatch?.[1]) {
      run.cliRunId = completedMatch[1];
    }
  }

  private async readRunEvents(runId: string): Promise<readonly JsonRecord[]> {
    const sqlitePath = path.join(this.repoRoot, "data", "local-dev.sqlite");
    let buffer: Buffer;
    try {
      buffer = await readFile(sqlitePath);
    } catch {
      return [];
    }

    const SQL = await this.sqlPromise;
    const db = new SQL.Database(new Uint8Array(buffer));
    try {
      const statement = db.prepare("SELECT payload_json FROM events WHERE run_id = ? ORDER BY sequence ASC", [runId]);
      const events: JsonRecord[] = [];
      try {
        while (statement.step()) {
          const row = statement.getAsObject() as Record<string, unknown>;
          const payloadJson = typeof row.payload_json === "string" ? row.payload_json : null;
          if (payloadJson) {
            events.push(asRecord(JSON.parse(payloadJson)));
          }
        }
      } finally {
        statement.free();
      }
      return events;
    } catch {
      return [];
    } finally {
      db.close();
    }
  }

  private buildState(
    run: RunProcess,
    summary: NormalizedRunSummary | null,
    eventState: DerivedEventState | null,
    screenshotPaths: readonly string[],
    error: string | null
  ): LiveRunState {
    const cliRunId = run.cliRunId;
    const latestScreenshotPath = screenshotPaths[screenshotPaths.length - 1] ?? eventState?.latestScreenshotPath ?? null;
    const summaryPath = cliRunId && summary ? getSummaryRelativePathForRun(cliRunId) : null;
    const latestAttempt = summary?.attempts.at(-1) ?? eventState?.latestAttempt ?? null;
    const shotHistory = summary?.attempts.flatMap((attempt) => [...attempt.shotHistory]) ?? eventState?.shotHistory ?? [];
    const latestObservation = eventState?.latestObservation ?? buildObservationFromAttempt(latestAttempt);
    const status = summary && run.status === "running" ? "completed" : run.status;

    return {
      botRunId: run.botRunId,
      cliRunId,
      status,
      phase: status === "stopped" || status === "failed" ? run.phase : eventState?.phase ?? run.phase,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      exitCode: run.exitCode,
      signal: run.signal,
      settings: run.settings,
      command: run.command,
      currentAttemptNumber: eventState?.currentAttemptNumber ?? latestAttempt?.attemptNumber ?? null,
      latestAction: eventState?.latestAction ?? null,
      latestShotPlan: eventState?.latestShotPlan ?? null,
      latestObservation,
      latestAttempt,
      shotHistory,
      latestScreenshotPath,
      latestScreenshotUrl: latestScreenshotPath ? `/artifact?path=${encodeURIComponent(latestScreenshotPath)}` : null,
      summaryPath,
      summary,
      stdoutTail: run.stdoutTail,
      stderrTail: run.stderrTail,
      error
    };
  }
}

interface DerivedEventState {
  readonly phase: string | null;
  readonly currentAttemptNumber: number | null;
  readonly latestAction: JsonRecord | null;
  readonly latestShotPlan: JsonRecord | null;
  readonly latestObservation: LiveObservation | null;
  readonly latestAttempt: NormalizedAttempt | null;
  readonly shotHistory: readonly NormalizedShot[];
  readonly latestScreenshotPath: string | null;
}

function deriveEventState(events: readonly JsonRecord[]): DerivedEventState {
  let phase: string | null = null;
  let currentAttemptNumber: number | null = null;
  let latestAction: JsonRecord | null = null;
  let latestShotPlan: JsonRecord | null = null;
  let latestObservation: LiveObservation | null = null;
  let latestAttempt: NormalizedAttempt | null = null;
  let latestScreenshotPath: string | null = null;
  const shotHistory: NormalizedShot[] = [];

  for (const event of events) {
    const type = readString(event, "type");
    if (type === "run.phase_changed" || type === "run.completed" || type === "run.failed" || type === "run.cancelled") {
      phase = readString(event, "phase") ?? type;
    }
    if (type === "observation.captured") {
      const observationKind = readString(event, "observationKind");
      const payload = recordAt(event, "payload");
      currentAttemptNumber = numberAt(payload, "attemptNumber") ?? currentAttemptNumber;
      if (observationKind === "attempt.completed") {
        latestAttempt = normalizeAttempt(payload);
        shotHistory.push(...arrayAt(payload, "shotHistory").map(normalizeShot));
      }
      const semanticState = recordAt(payload, "gameSemanticState");
      const observation = buildObservationFromSemanticState(semanticState);
      latestObservation = observation ?? latestObservation;
    }
    if (type === "action.executed") {
      const payload = recordAt(event, "payload");
      latestAction = {
        actionKind: readString(event, "actionKind"),
        status: readString(event, "status"),
        semanticActionId: readString(payload, "semanticActionId"),
        timestamp: readString(event, "timestamp")
      };
      const semanticParams = recordAt(payload, "semanticActionParams");
      if (readString(payload, "semanticActionId") === "execute-planned-shot" && Object.keys(semanticParams).length > 0) {
        latestShotPlan = semanticParams;
      }
    }
    if (type === "artifact.stored") {
      const artifact = recordAt(event, "artifact");
      if (readString(artifact, "kind") === "screenshot") {
        latestScreenshotPath = readString(artifact, "relativePath") ?? latestScreenshotPath;
      }
    }
  }

  return {
    phase,
    currentAttemptNumber,
    latestAction,
    latestShotPlan,
    latestObservation,
    latestAttempt,
    shotHistory,
    latestScreenshotPath
  };
}

function normalizeStartRequest(input: StartBotRunRequest): StartBotRunRequest {
  return {
    difficulty: ["easy", "normal", "hard", "impossible"].includes(input.difficulty) ? input.difficulty : "easy",
    maxAttempts: Number.isInteger(input.maxAttempts) ? Math.max(1, Math.min(50, input.maxAttempts)) : 3,
    strategyMode: input.strategyMode === "explore" ? "explore" : "baseline",
    stopOnWin: input.stopOnWin === true
  };
}

function buildSpawnSpec(cliArgs: readonly string[]): {
  readonly command: string;
  readonly args: readonly string[];
  readonly displayCommand: readonly string[];
} {
  const pnpmArgs = ["--filter", "@game-bots/bot-cli", "run", "dev", ...cliArgs];
  const displayCommand = ["pnpm", "run", "dev", "--", ...cliArgs];
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/c", "pnpm", ...pnpmArgs],
      displayCommand
    };
  }
  return {
    command: "pnpm",
    args: pnpmArgs,
    displayCommand
  };
}

function attachLineReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let lineBreakIndex = buffer.indexOf("\n");
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex).trim();
      buffer = buffer.slice(lineBreakIndex + 1);
      if (line.length > 0) {
        onLine(line);
      }
      lineBreakIndex = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    const line = buffer.trim();
    if (line.length > 0) {
      onLine(line);
    }
  });
}

function killWindowsProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true
    });
    killer.on("exit", () => resolve());
    killer.on("error", () => resolve());
  });
}

async function tryLoadSummary(repoRoot: string, runId: string): Promise<NormalizedRunSummary | null> {
  try {
    return await loadCatAndDogSummaryByRunId(repoRoot, runId);
  } catch {
    return null;
  }
}

export async function discoverScreenshotPaths(repoRoot: string, runId: string): Promise<string[]> {
  const screenshotsRoot = path.join(repoRoot, "artifacts", runId, "screenshots");
  const files = await findFiles(screenshotsRoot);
  return files
    .filter((filePath) => filePath.toLowerCase().endsWith(".png"))
    .sort()
    .map((filePath) => path.relative(path.join(repoRoot, "artifacts"), filePath).replace(/\\/g, "/"));
}

async function findFiles(root: string): Promise<string[]> {
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFiles(entryPath)));
    } else if (entry.isFile()) {
      results.push(entryPath);
    }
  }
  return results;
}

function buildObservationFromAttempt(attempt: NormalizedAttempt | null): LiveObservation | null {
  if (!attempt) {
    return null;
  }
  return {
    status: null,
    selectedWeapon: attempt.selectedWeapon,
    preparedAngle: attempt.preparedAngle,
    preparedPower: attempt.preparedPower,
    currentAngle: null,
    currentPower: null,
    playerHp: attempt.playerHp,
    cpuHp: attempt.cpuHp,
    windValue: attempt.wind.value,
    windDirection: attempt.wind.direction,
    windNormalized: attempt.wind.normalized,
    wallHp: attempt.wall.hp,
    wallDestroyed: attempt.wall.destroyed,
    outcome: attempt.outcome,
    endTitle: attempt.endTitle
  };
}

function buildObservationFromSemanticState(state: JsonRecord): LiveObservation | null {
  if (Object.keys(state).length === 0) {
    return null;
  }
  return {
    status: readString(state, "status"),
    selectedWeapon: readString(state, "selectedWeaponKey"),
    preparedAngle: numberAt(state, "preparedShotAngle"),
    preparedPower: numberAt(state, "preparedShotPower"),
    currentAngle: numberAt(state, "currentAimAngle"),
    currentPower: numberAt(state, "currentAimPower"),
    playerHp: numberAt(state, "runtimePlayerHp") ?? numberAt(state, "playerHpValue"),
    cpuHp: numberAt(state, "runtimeCpuHp") ?? numberAt(state, "cpuHpValue"),
    windValue: numberAt(state, "windValue"),
    windDirection: readString(state, "windDirection"),
    windNormalized: numberAt(state, "windNormalized"),
    wallHp: numberAt(state, "wallHp"),
    wallDestroyed: booleanAt(state, "wallDestroyed"),
    outcome: readString(state, "outcome"),
    endTitle: readString(state, "endTitleText")
  };
}

function parseJsonLine(line: string): JsonRecord | null {
  const normalized = stripAnsi(line);
  if (!normalized.startsWith("{")) {
    return null;
  }
  try {
    return asRecord(JSON.parse(normalized));
  } catch {
    return null;
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function pushTail(lines: string[], line: string): void {
  lines.push(stripAnsi(line));
  if (lines.length > MAX_TAIL_LINES) {
    lines.splice(0, lines.length - MAX_TAIL_LINES);
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

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberAt(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanAt(record: JsonRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}
