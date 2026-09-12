import { createReadStream, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { createServer, get, type IncomingMessage, type ServerResponse } from "node:http";
import { closeWindowsDesktopSessions } from "@game-bots/environment-windows";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BotRunManager, discoverScreenshotPaths } from "./live-runner.js";
import { DesktopManager } from "./desktop-manager.js";
import { DesktopRecordingManager } from "./desktop-recording-manager.js";
import { isLocalDesktopRequest } from "./desktop-security.js";
import {
  discoverCatAndDogSummaries,
  getSummaryRelativePathForRun,
  loadCatAndDogSummaryByRunId,
  loadCatAndDogSummary,
  resolveArtifactPath,
  resolveSummaryPath
} from "./summary-loader.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const publicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)));
const sourcePublicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)).replace(`${path.sep}dist${path.sep}`, `${path.sep}public${path.sep}`));
const staticRoot = publicRoot.endsWith(`${path.sep}dist${path.sep}public`) ? sourcePublicRoot : path.join(repoRoot, "apps", "bot-gui", "public");

const options = parseServerOptions(process.argv.slice(2));
const botRunManager = new BotRunManager(repoRoot);
const desktopManager = new DesktopManager(repoRoot);
const recordingManager = new DesktopRecordingManager(repoRoot, desktopManager);

const canonicalRoot = realpathSync(repoRoot);
const repositoryId = createHash("sha256").update(process.platform === "win32" ? canonicalRoot.toLowerCase() : canonicalRoot).digest("hex");
const identityPath = "/api/gui-instance";
let shuttingDown = false;

const server = createServer((request, response) => {
  if (shuttingDown) { sendJson(response, 503, { error: "GUI is shutting down." }); return; }
  void handleRequest(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected dashboard server error.";
    sendJson(response, 500, { error: message });
  });
});

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  server.closeAllConnections();
  // Bound shutdown even if a request or native dispatcher is stuck.
  const deadline = setTimeout(() => process.exit(exitCode || 1), 15000);
  const nativeDeadline = setTimeout(() => { void closeWindowsDesktopSessions(); }, 6000);
  try {
    await Promise.allSettled([botRunManager.close(), (async () => {
      try { await recordingManager.close(); }
      finally { await desktopManager.close(); }
    })()]);
  } finally {
    await closeWindowsDesktopSessions();
    clearTimeout(nativeDeadline);
    clearTimeout(deadline);
    process.exit(exitCode);
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(signal, () => { void shutdown(0); });
}
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (error: unknown) => {
    console.error("GUI stopped after an unexpected error:", error);
    void shutdown(1);
  });
}

function existingInstanceMatches(): Promise<boolean> {
  const hostname = options.host === "0.0.0.0" ? "127.0.0.1" : options.host === "::" ? "::1" : options.host;
  return new Promise(resolve => {
    const probe = get({ hostname, port: options.port, path: identityPath }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 4096) { probe.destroy(); resolve(false); }
      });
      response.on("error", () => resolve(false));
      response.on("end", () => {
        try {
          const identity = JSON.parse(body);
          resolve(response.statusCode === 200 && identity.app === "bot-gui" && identity.repositoryId === repositoryId);
        } catch { resolve(false); }
      });
    });
    const timeout = setTimeout(() => { probe.destroy(); resolve(false); }, 1500);
    probe.on("close", () => clearTimeout(timeout));
    probe.on("error", () => resolve(false));
  });
}

server.on("error", (error: NodeJS.ErrnoException) => {
  void (async () => {
    if (error.code === "EADDRINUSE") {
      if (await existingInstanceMatches()) {
        console.log(`This repository's bot GUI is already running on ${options.host}:${options.port}. Reuse the existing GUI.`);
        await shutdown(0);
      } else {
        console.error(`Cannot start GUI: ${options.host}:${options.port} is occupied by an unidentified server (possibly an older GUI). Close that server or use BOT_GUI_PORT to choose another port. No process was stopped.`);
        await shutdown(1);
      }
    } else {
      console.error(`Cannot start GUI: ${error.message}`);
      await shutdown(1);
    }
  })();
});

server.listen(options.port, options.host, () => {
  const hostForUrl = options.host === "0.0.0.0" ? "localhost" : options.host;
  process.stdout.write(`Cat-and-Dog bot GUI listening at http://${hostForUrl}:${options.port}\n`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const route = parseRoute(requestUrl.pathname);

  if (request.method === "GET" && requestUrl.pathname === identityPath) {
    response.setHeader("cache-control", "no-store");
    sendJson(response, 200, { app: "bot-gui", repositoryId });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/desktop/")) {
    if (!isLocalDesktopRequest(request)) { sendJson(response, 403, { error: "Desktop control requires a same-origin localhost request." }); return; }
    response.setHeader("cache-control", "no-store");
    try {
      const action = requestUrl.pathname.slice("/api/desktop/".length);
      if (request.method === "GET" && action === "windows") sendJson(response, 200, { windows: await desktopManager.windows() });
      else if (request.method === "GET" && action === "state") {
        const run = desktopManager.state();
        if (run?.profile.macro) { const { macro: _evidence, ...profile } = run.profile; sendJson(response, 200, { run: { ...run, profile } }); }
        else sendJson(response, 200, { run });
      }
      else if (request.method === "GET" && action === "profiles") sendJson(response, 200, { profiles: await desktopManager.profiles() });
      else if (request.method === "GET" && action === "teaching/behaviors") sendJson(response, 200, await recordingManager.behaviors());
      else if (request.method === "POST" && action === "local") sendJson(response, 200, await recordingManager.localOperation(await readRequestJson(request)));
      else if (request.method === "POST" && action === "teaching/review") sendJson(response, 200, await recordingManager.teachingOperation("review", await readRequestJson(request)));
      else if (request.method === "POST" && action === "teaching/delete") sendJson(response, 200, await recordingManager.teachingOperation("delete", await readRequestJson(request)));
      else if (request.method === "POST" && action === "teaching/analyze") {
        const body = await readRequestJson(request);
        sendJson(response, 202, await recordingManager.teachingOperation("analyze", body));
      }
      else if (request.method === "POST" && action === "teaching/cancel") { await recordingManager.teaching.cancelAnalysis(); sendJson(response, 200, recordingManager.teaching.snapshot()); }
      else if (request.method === "POST" && action === "profiles") sendJson(response, 200, await desktopManager.save(await readRequestJson(request)));
      else if (request.method === "POST" && action === "start") {
        const body = await readRequestJson(request); const result = await recordingManager.startBot(body);
        sendJson(response, 201, body.startMethod === undefined ? result.run : result);
      }
      else if (request.method === "POST" && action === "preview") sendJson(response, 200, await desktopManager.preview(await readRequestJson(request)));
      else if (request.method === "POST" && (action === "pause" || action === "resume" || action === "stop")) sendJson(response, 200, await recordingManager.botControl(action));
      else if (request.method === "GET" && action === "recording/state") sendJson(response, 200, recordingManager.snapshot(requestUrl.searchParams.has("knownDraft") ? Number(requestUrl.searchParams.get("knownDraft")) : undefined));
      else if (request.method === "GET" && action === "recording/settings") sendJson(response, 200, await recordingManager.settings());
      else if (request.method === "POST" && action === "recording/settings") sendJson(response, 200, await recordingManager.saveSettings(await readRequestJson(request)));
      else if (request.method === "POST" && action === "recording/start") sendJson(response, 201, await recordingManager.record(await readRequestJson(request)));
      else if (request.method === "POST" && action.startsWith("recording/")) {
        const command = action.slice("recording/".length);
        if (command !== "pause" && command !== "resume" && command !== "stop" && command !== "discard") throw new Error("Unknown recording control");
        sendJson(response, 200, await recordingManager.recordingControl(command));
      }
      else sendJson(response, 404, { error: "Desktop route not found" });
    } catch (error) { sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/runs") {
    sendJson(response, 200, { runs: await discoverCatAndDogSummaries(repoRoot) });
    return;
  }

  if (request.method === "GET" && route?.area === "runs" && route.rest.length === 1) {
    const runId = route.rest[0];
    if (!runId) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    const live = botRunManager.findRun(runId);
    if (live) {
      sendJson(response, 200, await botRunManager.getLiveState(runId));
      return;
    }
    sendJson(response, 200, await loadCatAndDogSummaryByRunId(repoRoot, runId));
    return;
  }

  if (request.method === "GET" && route?.area === "runs" && route.rest.length === 2 && route.rest[1] === "summary") {
    const runId = route.rest[0];
    if (!runId) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    sendJson(response, 200, await loadCatAndDogSummaryByRunId(repoRoot, runId));
    return;
  }

  if (request.method === "GET" && route?.area === "runs" && route.rest.length === 2 && route.rest[1] === "latest-screenshot") {
    const runId = route.rest[0];
    if (!runId) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    const live = botRunManager.findRun(runId);
    const liveState = live ? await botRunManager.getLiveState(runId) : null;
    const completedScreenshots = liveState ? [] : await discoverScreenshotPaths(repoRoot, runId);
    const completedPath = completedScreenshots[completedScreenshots.length - 1] ?? null;
    sendJson(response, 200, {
      runId,
      path: liveState?.latestScreenshotPath ?? completedPath,
      url: liveState?.latestScreenshotUrl ?? (completedPath ? `/artifact?path=${encodeURIComponent(completedPath)}` : null)
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/bot-runs") {
    sendJson(response, 200, { runs: await Promise.all(botRunManager.getAllRuns().map((run) => botRunManager.getLiveState(run.botRunId))) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/bot-runs/start") {
    const body = await readRequestJson(request);
    sendJson(response, 201, botRunManager.start({
      gameId:
        body.gameId === "chess-com-web"
          ? "chess-com-web"
          : body.gameId === "minesweeper-online-web"
            ? "minesweeper-online-web"
            : "cat-and-dog-web",
      difficulty:
        body.difficulty === "beginner" ||
        body.difficulty === "normal" ||
        body.difficulty === "hard" ||
        body.difficulty === "impossible"
          ? body.difficulty
          : "easy",
      maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : 3,
      maxMoves: typeof body.maxMoves === "number" ? body.maxMoves : 80,
      strategyMode: body.strategyMode === "explore" ? "explore" : "baseline",
      stopOnWin: body.stopOnWin === true,
      headless: body.headless !== false
    }));
    return;
  }

  if (request.method === "POST" && route?.area === "bot-runs" && route.rest.length === 2 && route.rest[1] === "stop") {
    const runId = route.rest[0];
    if (!runId) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    sendJson(response, 200, await botRunManager.stop(runId));
    return;
  }

  if (request.method === "GET" && route?.area === "bot-runs" && route.rest.length === 2 && route.rest[1] === "live") {
    const runId = route.rest[0];
    if (!runId) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    sendJson(response, 200, await botRunManager.getLiveState(runId));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/summary") {
    const requestedPath = requestUrl.searchParams.get("path");
    if (!requestedPath) {
      sendJson(response, 400, { error: "Missing summary path." });
      return;
    }
    const summaryPath = resolveSummaryPath(repoRoot, requestedPath);
    sendJson(response, 200, await loadCatAndDogSummary(repoRoot, summaryPath));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/artifact") {
    const artifactPath = requestUrl.searchParams.get("path");
    if (!artifactPath) {
      sendJson(response, 400, { error: "Missing artifact path." });
      return;
    }
    const resolvedArtifact = resolveArtifactPath(repoRoot, artifactPath);
    if (path.relative(path.join(repoRoot, "artifacts"), resolvedArtifact).split(path.sep)[0]?.startsWith("desktop-") && !isLocalDesktopRequest(request)) {
      sendJson(response, 403, { error: "Desktop evidence requires localhost access." }); return;
    }
    await sendFile(response, resolvedArtifact);
    return;
  }

  if (request.method === "GET" && route?.area === "artifact-summary-path" && route.rest.length === 1) {
    const runId = route.rest[0];
    if (!runId) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    sendJson(response, 200, { path: getSummaryRelativePathForRun(runId) });
    return;
  }

  const staticPath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
  await sendStaticFile(response, staticPath);
}

function parseRoute(pathname: string): { readonly area: string; readonly rest: readonly string[] } | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "api") {
    return null;
  }
  if (parts[1] === "runs") {
    return { area: "runs", rest: parts.slice(2) };
  }
  if (parts[1] === "bot-runs") {
    return { area: "bot-runs", rest: parts.slice(2) };
  }
  if (parts[1] === "artifact-summary-path") {
    return { area: "artifact-summary-path", rest: parts.slice(2) };
  }
  return null;
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > (request.url?.startsWith("/api/desktop/") ? 24 * 1024 * 1024 : 262144)) throw new Error("Request body exceeds the allowed size");
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

async function sendStaticFile(response: ServerResponse, relativePath: string): Promise<void> {
  const resolvedPath = path.resolve(staticRoot, relativePath);
  const relativeToStaticRoot = path.relative(staticRoot, resolvedPath);
  if (relativeToStaticRoot.startsWith("..") || path.isAbsolute(relativeToStaticRoot)) {
    sendJson(response, 404, { error: "Static file not found." });
    return;
  }
  await sendFile(response, resolvedPath);
}

async function sendFile(response: ServerResponse, filePath: string): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
  } catch {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  response.statusCode = 200;
  response.setHeader("content-type", contentTypeForPath(filePath));
  createReadStream(filePath).pipe(response);
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value, null, 2));
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function parseServerOptions(args: readonly string[]): { readonly host: string; readonly port: number } {
  const portArg = args.find((arg) => arg.startsWith("--port="));
  const hostArg = args.find((arg) => arg.startsWith("--host="));
  const parsedPort = portArg ? Number(portArg.slice("--port=".length)) : Number(process.env.BOT_GUI_PORT ?? 5178);

  return {
    host: hostArg?.slice("--host=".length) || process.env.BOT_GUI_HOST || "127.0.0.1",
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 5178
  };
}
