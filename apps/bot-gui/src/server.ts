import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BotRunManager, discoverScreenshotPaths } from "./live-runner.js";
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

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unexpected dashboard server error.";
    sendJson(response, 500, { error: message });
  });
});

server.listen(options.port, options.host, () => {
  const hostForUrl = options.host === "0.0.0.0" ? "localhost" : options.host;
  process.stdout.write(`Cat-and-Dog bot GUI listening at http://${hostForUrl}:${options.port}\n`);
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const route = parseRoute(requestUrl.pathname);

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
      gameId: body.gameId === "chess-com-web" ? "chess-com-web" : "cat-and-dog-web",
      difficulty: body.difficulty === "normal" || body.difficulty === "hard" || body.difficulty === "impossible" ? body.difficulty : "easy",
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
    await sendFile(response, resolveArtifactPath(repoRoot, artifactPath));
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
  for await (const chunk of request) {
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
