import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { WindowsDesktopSession } from "../packages/environment-windows/dist/index.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "artifacts", "desktop-smoke-" + Date.now());
await mkdir(out, { recursive: true });
const log = path.join(out, "fixture.log");
const fixture = spawn(path.join(root, "packages/environment-windows/bin/DesktopFixture.exe"), [log], { windowsHide: false, stdio: "pipe" });
fixture.on("error", e => { throw e; });
let session;
const results = [];
const command = async value => { fixture.stdin.write(value + "\n"); await wait(250); };
const signal = new AbortController().signal;
async function connect() {
  session = new WindowsDesktopSession();
  const target = (await session.listWindows()).find(w => w.pid === fixture.pid);
  assert.ok(target, "Fixture window is enumerated");
  await session.bind(target, 60000); await command("activate"); await session.focus(); await wait(200); await session.resume();
  return session.observe();
}
async function assertReleased(label) {
  const health = await session.health(); assert.deepEqual(health.heldKeys, []); assert.deepEqual(health.heldButtons, []);
  await command("state"); assert.match((await readFile(log, "utf8")).trim().split(/\r?\n/).filter(line => line.startsWith("physical ")).at(-1), /physical W=False Left=False/);
  results.push(label);
}
try {
  await wait(1200);
  let observation = await connect();
  await writeFile(path.join(out, "before.png"), observation.png);
  assert.equal(observation.window.bounds.width, 640);
  const act = action => session.execute(action, observation.geometry, signal);
  for (const button of ["left", "right", "middle"]) await act({ kind: "click", point: { x: .5, y: .5 }, button, durationMs: 40 });
  await act({ kind: "hold", keys: ["KeyW", "Space"], buttons: ["left"], durationMs: 150 });
  await act({ kind: "key-down", key: "KeyW" });
  await act({ kind: "button-down", button: "right" });
  await act({ kind: "relative-move", dx: 20, dy: 5 });
  await act({ kind: "button-up", button: "right" });
  await act({ kind: "key-up", key: "KeyW" });
  await act({ kind: "drag", from: { x: .4, y: .5 }, to: { x: .6, y: .6 }, button: "left", durationMs: 100 });
  await act({ kind: "scroll", ticks: -1, axis: "vertical" });
  await act({ kind: "hold", keys: ["Control", "KeyA"], buttons: [], durationMs: 50 });
  const after = await session.observe(); await writeFile(path.join(out, "after.png"), after.png);
  assert.notEqual(after.sha256, observation.sha256);
  const events = await readFile(log, "utf8");
  for (const pattern of [/button-down Left/, /button-down Right/, /button-down Middle/, /key-down W/, /key-up W/, /key-down Space/, /wheel -120/, /key-down ControlKey/]) assert.match(events, pattern);
  results.push("Visible capture, left/right/middle, keys/chord, overlapping input, relative movement, drag, wheel");
  const cancel = new AbortController();
  const holding = session.execute({ kind: "hold", keys: ["KeyW"], buttons: ["left"], durationMs: 5000 }, observation.geometry, cancel.signal);
  const interrupted = assert.rejects(holding); await wait(150); cancel.abort(); await interrupted;
  await assertReleased("Cancellation releases actual OS key/button state");
  await act({ kind: "key-down", key: "KeyW" });
  const other = spawn(path.join(root, "packages/environment-windows/bin/DesktopFixture.exe"), [], { windowsHide: false, stdio: "pipe" });
  try {
    await wait(1000); await command(`allow-focus ${other.pid}`); other.stdin.write("activate\n"); await wait(300);
    assert.equal((await session.health()).armed, false);
    assert.match((await session.health()).reason, /focus/);
    await assertReleased("Unexpected foreground-window change releases input");
  } finally { other.stdin.write("close\n"); other.stdin.end(); }
  await command("activate"); await session.resume(); observation = await session.observe();
  await act({ kind: "key-down", key: "KeyW" }); await command("move-window");
  assert.equal((await session.health()).armed, false); await assertReleased("Window movement disarms and releases input");
  await session.resume();
  await assert.rejects(act({ kind: "click", point: { x: .5, y: .5 }, button: "left", durationMs: 40 }), /Stale/);
  results.push("Stale geometry rejected");
  await session.resume(); observation = await session.observe();
  await act({ kind: "key-down", key: "KeyW" }); await command("resize");
  assert.equal((await session.health()).armed, false); await assertReleased("Resize disarms and releases input");
  await session.resume(); observation = await session.observe();
  await act({ kind: "key-down", key: "KeyW" }); await command("minimize");
  assert.equal((await session.health()).armed, false); await assertReleased("Target minimize/loss releases input");
  await command("activate"); await session.resume(); observation = await session.observe();
  await act({ kind: "key-down", key: "KeyW" }); await command("emergency");
  assert.match((await session.health()).reason, /F8/); await assertReleased("Global F8 disarms and releases input");
  await assert.rejects(session.resume(), /F8/);
  await session.close();
  observation = await connect();
  await act({ kind: "key-down", key: "KeyW" }); await session.close();
  await command("state"); assert.match((await readFile(log, "utf8")).trim().split(/\r?\n/).filter(line => line.startsWith("physical ")).at(-1), /physical W=False Left=False/);
  results.push("Closing helper releases actual OS state");
  for (const mode of ["crash", "stall", "hold-limit", "deadline"]) {
    await command("activate");
    const observer = new WindowsDesktopSession();
    let target;
    try { target = (await observer.listWindows()).find(w => w.pid === fixture.pid); } finally { await observer.close(); }
    const controller = spawn(process.execPath, [path.join(root, "scripts/desktop-watchdog-child.mjs"), mode, JSON.stringify(target)], { windowsHide: true, stdio: "pipe" });
    let stdout = "", stderr = "";
    controller.stdout.on("data", d => { stdout += d; }); controller.stderr.on("data", d => { stderr += d; });
    const exited = new Promise(resolve => controller.on("exit", code => resolve(code)));
    try {
      for (let i = 0; i < 50 && !stdout.includes("ARMED"); i++) { if (controller.exitCode !== null) throw new Error(stderr); await wait(100); }
      assert.match(stdout, /ARMED/, "Watchdog test controller armed");
      if (mode === "crash") { controller.kill(); await exited; await wait(700); }
      else {
        const code = await exited; assert.equal(code, 0, stderr);
        const health = JSON.parse(stdout.trim().split("\n").at(-1));
        assert.equal(health.armed, false); assert.deepEqual(health.heldKeys, []); assert.deepEqual(health.heldButtons, []);
        assert.match(health.reason, mode === "stall" ? /heartbeat/ : mode === "deadline" ? /deadline/ : /Held input/);
      }
      await command("state");
      assert.match((await readFile(log, "utf8")).split(/\r?\n/).filter(line => line.startsWith("physical ")).at(-1), /physical W=False Left=False/);
      results.push(`Independent native cleanup: ${mode}`);
    } finally { if (controller.exitCode === null) controller.kill(); }
  }
  // Real GUI HTTP -> DesktopRunner -> helper -> fixture -> artifact path, without a model.
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, "127.0.0.1", () => { const address = socket.address(); socket.close(() => resolve(address.port)); }); });
  const gui = spawn(process.execPath, [path.join(root, "apps/bot-gui/dist/server.js"), `--port=${port}`], { windowsHide: true, stdio: "pipe" });
  const base = `http://127.0.0.1:${port}`;
  const post = async (route, data) => { const response = await fetch(base + "/api/desktop/" + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }); const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body; };
  try {
    for (let i = 0; i < 30; i++) { try { if ((await fetch(base)).ok) break; } catch {} await wait(100); }
    await command("activate");
    const { windows } = await (await fetch(base + "/api/desktop/windows")).json();
    const target = windows.find(w => w.pid === fixture.pid);
    const preview = await post("preview", target); assert.match(preview.image, /^data:image\/png;base64,/);
    const profile = JSON.parse(await readFile(path.join(root, "profiles/desktop/native-control-test.json"), "utf8"));
    profile.startDelayMs = 0;
    const started = await post("start", { target, profile });
    let run;
    for (let i = 0; i < 100; i++) { ({ run } = await (await fetch(base + "/api/desktop/state")).json()); if (run.report) break; await wait(150); }
    assert.equal(run.status, "completed", JSON.stringify(run)); assert.equal(run.actionCount, 9); assert.ok(run.report);
    const picture = await fetch(base + "/artifact?path=" + encodeURIComponent(run.latestScreenshot.relativePath));
    assert.equal(picture.status, 200); assert.equal(picture.headers.get("content-type"), "image/png");
    const report = await (await fetch(base + "/artifact?path=" + encodeURIComponent(run.report.relativePath))).json();
    assert.equal(report.runId, started.runId); assert.equal(report.history.length, 9);
    results.push("Real GUI HTTP launch, preview, nine-action native profile, screenshots, completed JSON report");
  } finally { try { await post("stop", {}); } finally { gui.kill(); } }
  await writeFile(path.join(out, "results.json"), JSON.stringify({ results, roblox: "Not tested", limitations: ["One monitor/DPI environment", "Horizontal scroll not asserted", "Game camera acceptance unverified"] }, null, 2));
  console.log(JSON.stringify({ passed: results, artifacts: out }, null, 2));
} finally {
  try { await session?.close(); }
  finally { await command("release-test-input"); fixture.stdin.write("close\n"); fixture.stdin.end(); }
}
