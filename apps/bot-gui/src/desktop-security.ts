import type { IncomingMessage } from "node:http";

/** Desktop endpoints are local-only even if the browser dashboard is LAN-bound. */
export function isLocalDesktopRequest(request: IncomingMessage): boolean {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "")) return false;
  const host = request.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  return request.method === "GET" || (request.headers["content-type"] ?? "").split(";")[0] === "application/json";
}
