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
  await page.locator("#editor > summary").click();
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
  await page.getByRole("button", { name: "Refresh windows" }).click(); await page.getByRole("button", { name: "Start Bot", exact: true }).click();
  await expect(page.locator("#status")).toContainText("running");
  await expect(page.locator("#observation")).toHaveAttribute("src", /path=desktop-test%2Fscreenshots/);
  await expect.poll(() => page.locator("#observation").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "Pause Bot", exact: true }).click(); await expect(page.locator("#status")).toContainText("paused");
  await page.getByRole("button", { name: "Resume Bot", exact: true }).click(); await expect(page.locator("#status")).toContainText("running");
  await page.getByRole("button", { name: "Stop Bot / cancel start" }).click(); await expect(page.locator("#status")).toContainText("stopped");
  await expect(page.locator("#report")).toHaveAttribute("href", "/artifact?path=desktop-test%2Freports%2Fdesktop-summary.json");
  expect(controls).toEqual(["pause", "resume", "stop"]); expect(errors).toEqual([]);
});
test("desktop HTTP boundary rejects hostile origins and invalid configuration", async ({ request }) => {
  const hostile = await request.post(base + "/api/desktop/start", { headers: { origin: "https://attacker.example" }, data: {} }); expect(hostile.status()).toBe(403);
  const invalid = await request.post(base + "/api/desktop/start", { data: {} }); expect(invalid.status()).toBe(400);
  const oversized = await request.post(base + "/api/desktop/profiles", { data: { name: "x".repeat(2100000) } }); expect(oversized.status()).toBe(400);
});

test("recording controls produce an editable saved sequence and arm playback separately", async ({ page }) => {
  // Every desktop endpoint is mocked: this test never creates a native helper or sends desktop input.
  const target = { handle: "123", pid: 456, processStartedAt: "1", title: "Mock target", processName: "fixture", bounds: { x: 0, y: 0, width: 640, height: 480 }, dpi: 96 };
  const keys = { record: "F6", bot: "F7", stopRecording: "F9" };
  const draft = DesktopProfileSchema.parse({ version: 1, name: "My recording", playback: "recorded", loop: { mode: "once" }, actions: [
    { kind: "key-down", key: "KeyW", delayBeforeMs: 0 },
    { kind: "key-down", key: "Space", delayBeforeMs: 800 },
    { kind: "key-up", key: "Space", delayBeforeMs: 100 },
    { kind: "key-up", key: "KeyW", delayBeforeMs: 500 },
    { kind: "release-all", delayBeforeMs: 100 }
  ] });
  const capture: any = { recording: null, draft: null, draftId: 0, error: null, botArmed: false, armedProfileName: null };
  const saved: ReturnType<typeof DesktopProfileSchema.parse>[] = [];
  const calls: string[] = []; let starts = 0;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/desktop/**", async route => {
    const endpoint = new URL(route.request().url()).pathname.replace("/api/desktop/", "");
    const post = route.request().method() === "POST";
    const body = post ? route.request().postDataJSON() : null;
    if (post) calls.push(endpoint);
    if (endpoint === "windows") return route.fulfill({ json: { windows: [target] } });
    if (endpoint === "profiles") {
      if (post) saved.push(DesktopProfileSchema.parse(body));
      return route.fulfill({ json: { profiles: saved } });
    }
    if (endpoint === "recording/settings") return route.fulfill({ json: keys });
    if (endpoint === "state") return route.fulfill({ json: { run: null } });
    if (endpoint === "recording/state") return route.fulfill({ json: capture });
    if (endpoint === "recording/start") {
      expect(body).toMatchObject({ target, startMethod: "delay", delayMs: 3000 });
      capture.recording = { status: "countdown", elapsedMs: 0, countdownMs: 3000, eventCount: 0, target, reason: "Countdown" };
    } else if (endpoint === "recording/discard") {
      capture.recording = { ...capture.recording, status: "idle" }; capture.draft = null;
    } else if (endpoint === "recording/pause") capture.recording.status = "paused";
    else if (endpoint === "recording/resume") capture.recording.status = "recording";
    else if (endpoint === "recording/stop") {
      capture.recording.status = "stopped"; capture.draft = draft; capture.draftId++;
    } else if (endpoint === "start") {
      starts++; expect(body.startMethod).toBe("hotkey");
      const profile = DesktopProfileSchema.parse(body.profile);
      expect(profile.loop).toEqual({ mode: "count", count: 3, delayMs: 2000 });
      capture.botArmed = true; capture.armedProfileName = profile.name;
    } else if (endpoint === "stop") capture.botArmed = false;
    else throw new Error("Unexpected desktop API request: " + endpoint);
    await route.fulfill({ json: capture });
  });
  await page.goto(base + "/desktop.html");
  await page.getByRole("button", { name: "Refresh windows" }).click();
  await page.getByRole("button", { name: "Start Recording", exact: true }).click();
  await expect(page.locator("#record-status")).toContainText("Recording starts in 3");
  await expect(page.locator("#start")).toBeDisabled();
  await page.getByRole("button", { name: "Discard Recording" }).click();
  await expect(page.locator("#record-start")).toBeEnabled();
  await page.getByRole("button", { name: "Start Recording", exact: true }).click();
  capture.recording = { ...capture.recording, status: "recording", eventCount: 4, elapsedMs: 1400 };
  await expect(page.locator("#activity")).toContainText("you control the target");
  await page.getByRole("button", { name: "Pause Recording", exact: true }).click();
  await expect(page.locator("#record-status")).toContainText("paused");
  await page.getByRole("button", { name: "Resume Recording", exact: true }).click();
  await page.getByRole("button", { name: "Stop Recording", exact: true }).click();
  await expect(page.locator(".desktop-action")).toHaveCount(5);
  expect(starts).toBe(0);
  await expect(page.locator("#timing")).toHaveValue("recorded");
  const first = page.locator(".desktop-action").first();
  await first.locator('[data-field="paired-duration"]').fill("1600");
  await page.locator("#name").fill("Edited demonstration");
  await expect(page.locator(".desktop-action").nth(3).locator('[data-field="delayBeforeMs"]')).toHaveValue("700");
  await page.locator(".desktop-action").nth(1).locator('[data-field="enabled"]').uncheck();
  await page.locator(".desktop-action").nth(1).getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.locator(".desktop-action")).toHaveCount(6);
  await page.locator(".desktop-action").nth(2).getByRole("button", { name: "Delete", exact: true }).click();
  await first.getByRole("button", { name: "Insert wait", exact: true }).click();
  await page.locator(".desktop-action").nth(1).getByRole("button", { name: "Down", exact: false }).click();
  await page.getByRole("button", { name: "Save configuration", exact: true }).click();
  await expect(page.locator("#message")).toHaveText("Configuration saved locally.");
  expect(saved[0]!.actions).toHaveLength(6);
  expect(saved[0]!.actions[1]).toMatchObject({ enabled: false, delayBeforeMs: 800 });
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await expect(page.locator("#message")).toHaveText("Copy saved.");
  expect(saved).toHaveLength(2);
  await page.reload(); await page.locator("#profiles").selectOption({ label: "Edited demonstration" });
  await expect(page.locator(".desktop-action")).toHaveCount(6);
  await page.getByRole("button", { name: "Refresh windows" }).click();
  await page.locator("#loop").selectOption("count"); await page.locator("#loop-count").fill("3");
  await page.locator("#loop-delay").fill("2"); await page.locator("#bot-method").selectOption("hotkey");
  await page.getByRole("button", { name: "Arm Bot Hotkey", exact: true }).click();
  await expect(page.locator("#activity")).toContainText("Bot armed");
  await expect(page.locator("#record-start")).toBeDisabled();
  await page.getByRole("button", { name: "Stop Bot / cancel start" }).click();
  await expect(page.locator("#record-start")).toBeEnabled();
  expect(starts).toBe(1); expect(errors).toEqual([]);
  expect(calls).toContain("recording/discard"); expect(calls).toContain("recording/stop");
});
