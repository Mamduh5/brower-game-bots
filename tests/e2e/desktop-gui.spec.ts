import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopProfileSchema } from "../../packages/game-sdk/dist/index.js";

let server: ChildProcess, base: string;
const root = fileURLToPath(new URL("../..", import.meta.url));
const name = "GUI test " + Date.now();
test.beforeAll(async () => {
  const port = await new Promise<number>(resolve => { const socket = createServer(); socket.listen(0, "127.0.0.1", () => { const address = socket.address(); if (typeof address === "object" && address) socket.close(() => resolve(address.port)); }); });
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(root, "apps/bot-gui/dist/server.js"), `--port=${port}`], { cwd: root, windowsHide: true, stdio: "pipe" });
  await expect.poll(async () => { try { return (await fetch(base)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  server?.kill();
  const filename = createHash("sha256").update(name).digest("hex") + ".json";
  await rm(path.join(root, "data", "desktop-profiles", filename), { force: true });
});
test("desktop editor saves valid configuration, controls runs and displays screenshot/report URLs", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(base); await page.getByRole("link", { name: "Desktop automation" }).click();
  await expect(page.getByRole("heading", { name: "Desktop automation" })).toBeVisible();
  await page.locator("#profiles").selectOption({ label: "Clicker example" });
  await page.locator("#name").fill(name); await page.locator("#interval").fill("250");
  await page.getByRole("button", { name: "Add action", exact: true }).click();
  const row = page.locator(".desktop-action").last(); await row.locator('[data-field="kind"]').selectOption("hold");
  await row.locator('[data-field="keys"]').fill("Control,KeyA");
  await page.getByRole("button", { name: "Save configuration", exact: true }).click();
  await expect(page.locator("#message")).toHaveText("Configuration saved locally.");
  await page.reload(); await page.locator("#profiles").selectOption({ label: name });
  await expect(page.locator(".desktop-action")).toHaveCount(2); await expect(page.locator("#interval")).toHaveValue("250");
  const target = { handle: "123", pid: 456, processStartedAt: "1", title: "Controlled fixture", processName: "fixture", bounds: { x: -640, y: 0, width: 640, height: 480 }, dpi: 144 };
  let run: Record<string, unknown> | null = null;
  const controls: string[] = [];
  await page.route("**/artifact?**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afo4AAAAASUVORK5CYII=", "base64") }));
  // Physical input is exercised by test:desktop. This test isolates the GUI contract.
  await page.route("**/api/desktop/windows", route => route.fulfill({ json: { windows: [target] } }));
  await page.route("**/api/desktop/state", route => route.fulfill({ json: { run } }));
  await page.route("**/api/desktop/start", async route => {
    const body = route.request().postDataJSON(); const profile = DesktopProfileSchema.parse(body.profile);
    expect(body.target).toEqual(target); expect(profile.actions[1]).toMatchObject({ kind: "hold", keys: ["Control", "KeyA"] });
    run = { runId: "desktop-test", status: "running", actionCount: 1, profile, reason: "Running", latestAction: profile.actions[0], latestScreenshot: { relativePath: "desktop-test/screenshots/0000.png", createdAt: "now" }, logs: [], report: null };
    await route.fulfill({ json: run });
  });
  await page.route("**/api/desktop/pause", async route => { controls.push("pause"); run!.status = "paused"; await route.fulfill({ json: { run } }); });
  await page.route("**/api/desktop/resume", async route => { controls.push("resume"); run!.status = "running"; await route.fulfill({ json: { run } }); });
  await page.route("**/api/desktop/stop", async route => { controls.push("stop"); run!.status = "stopped"; run!.report = { relativePath: "desktop-test/reports/desktop-summary.json" }; await route.fulfill({ json: { run } }); });
  await page.getByRole("button", { name: "Refresh windows" }).click(); await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.locator("#status")).toContainText("running");
  await expect(page.locator("#observation")).toHaveAttribute("src", /path=desktop-test%2Fscreenshots/);
  await expect.poll(() => page.locator("#observation").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click(); await expect(page.locator("#status")).toContainText("paused");
  await page.getByRole("button", { name: "Resume", exact: true }).click(); await expect(page.locator("#status")).toContainText("running");
  await page.getByRole("button", { name: "Stop input" }).click(); await expect(page.locator("#status")).toContainText("stopped");
  await expect(page.locator("#report")).toHaveAttribute("href", "/artifact?path=desktop-test%2Freports%2Fdesktop-summary.json");
  expect(controls).toEqual(["pause", "resume", "stop"]); expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(root, "artifacts", "desktop-gui.png"), fullPage: true });
});
test("desktop HTTP boundary rejects hostile origins and invalid configuration", async ({ request }) => {
  const hostile = await request.post(base + "/api/desktop/start", { headers: { origin: "https://attacker.example" }, data: {} }); expect(hostile.status()).toBe(403);
  const invalid = await request.post(base + "/api/desktop/start", { data: {} }); expect(invalid.status()).toBe(400);
  const oversized = await request.post(base + "/api/desktop/profiles", { data: { name: "x".repeat(270000) } }); expect(oversized.status()).toBe(400);
});
