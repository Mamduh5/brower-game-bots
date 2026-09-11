import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isLocalDesktopRequest } from "../src/desktop-security.js";
function request(headers: Record<string, string>, address = "127.0.0.1", method = "POST") { return { method, headers: { host: "127.0.0.1:5178", "content-type": "application/json", ...headers }, socket: { remoteAddress: address } } as IncomingMessage; }
describe("desktop API origin boundary", () => {
  it("accepts same-origin JSON and local scripts", () => { expect(isLocalDesktopRequest(request({ origin: "http://127.0.0.1:5178" }))).toBe(true); expect(isLocalDesktopRequest(request({}))).toBe(true); });
  it.each([{ origin: "https://attacker.example" }, { host: "attacker.example:5178" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }])("rejects cross-site control %j", headers => { expect(isLocalDesktopRequest(request(headers))).toBe(false); });
  it("rejects LAN clients even if the browser dashboard is exposed", () => { expect(isLocalDesktopRequest(request({}, "192.168.1.2"))).toBe(false); });
});
