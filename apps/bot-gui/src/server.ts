import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverCatAndDogSummaries,
  loadCatAndDogSummary,
  resolveArtifactPath,
  resolveSummaryPath
} from "./summary-loader.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const publicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)));
const sourcePublicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)).replace(`${path.sep}dist${path.sep}`, `${path.sep}public${path.sep}`));
const staticRoot = publicRoot.endsWith(`${path.sep}dist${path.sep}public`) ? sourcePublicRoot : path.join(repoRoot, "apps", "bot-gui", "public");

const options = parseServerOptions(process.argv.slice(2));

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

  if (requestUrl.pathname === "/api/runs") {
    sendJson(response, 200, { runs: await discoverCatAndDogSummaries(repoRoot) });
    return;
  }

  if (requestUrl.pathname === "/api/summary") {
    const requestedPath = requestUrl.searchParams.get("path");
    if (!requestedPath) {
      sendJson(response, 400, { error: "Missing summary path." });
      return;
    }
    const summaryPath = resolveSummaryPath(repoRoot, requestedPath);
    sendJson(response, 200, await loadCatAndDogSummary(repoRoot, summaryPath));
    return;
  }

  if (requestUrl.pathname === "/artifact") {
    const artifactPath = requestUrl.searchParams.get("path");
    if (!artifactPath) {
      sendJson(response, 400, { error: "Missing artifact path." });
      return;
    }
    await sendFile(response, resolveArtifactPath(repoRoot, artifactPath));
    return;
  }

  const staticPath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
  await sendStaticFile(response, staticPath);
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

