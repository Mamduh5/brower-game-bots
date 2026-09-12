import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopRecordingManager } from "../src/desktop-recording-manager.js";
import { DesktopHotkeysSchema, type DesktopRecorder, type RecordingOptions, type RecordingState, type DesktopHotkeys } from "@game-bots/environment-sdk";
import { DesktopProfileSchema } from "@game-bots/game-sdk";
import type { DesktopRunState } from "@game-bots/agent-player";
import type { VisualModel } from "@game-bots/agent-player";
import { DesktopTeachingManager } from "../src/desktop-teaching-manager.js";
import { PNG } from "pngjs";

const target = { handle: "123", pid: 12, processStartedAt: "1", title: "Owned fixture", processName: "fixture", dpi: 96, bounds: { x: -200, y: 0, width: 640, height: 480 } };
const profile = DesktopProfileSchema.parse({ version: 1, name: "demo", startDelayMs: 500, actions: [{ kind: "key-down", key: "KeyW" }] });
class FakeRecorder implements DesktopRecorder {
  frames: Awaited<ReturnType<NonNullable<DesktopRecorder["recordingFrames"]>>> = [];
  async recordingFrames() { const frames = this.frames; this.frames = []; return frames; }
  closed = false; registrationError = false;
  state: RecordingState = { status: "idle", reason: "Idle", elapsedMs: 0, countdownMs: 0, eventCount: 0, revision: 0, target: null, hotkeys: null, botArmed: false, botActive: false, commands: [] };
  async configureHotkeys(keys: DesktopHotkeys) { if (this.registrationError) throw new Error("Could not register F6"); this.state.hotkeys = keys; return structuredClone(this.state); }
  async recordingCommand(command: string, options?: RecordingOptions) {
    if (command === "prepare") { this.state.status = "armed"; this.state.target = options!.target; this.state.countdownMs = options!.delayMs; }
    if (command === "start" || command === "resume") this.state.status = "countdown";
    if (command === "pause") this.state.status = "paused";
    if (command === "stop") { this.state.status = "stopped"; this.state.events = [{ atMs: 0, action: { kind: "key-down", key: "KeyW" } }, { atMs: 800, action: { kind: "key-up", key: "KeyW" } }]; this.state.eventCount = 2; }
    if (command === "discard") { this.state.status = "idle"; this.state.events = []; this.state.eventCount = 0; }
    this.state.revision++; return structuredClone(this.state);
  }
  async recordingState() { const state = structuredClone(this.state); this.state.commands = []; return state; }
  async setBotControl(armed: boolean, active: boolean) { this.state.botArmed = armed; this.state.botActive = active; }
  async close() { this.closed = true; }
}
const cleanup: { root: string; manager: DesktopRecordingManager }[] = [];
async function setup(modelFactory?: () => VisualModel) {
  const root = await mkdtemp(path.join(os.tmpdir(), "game-bots-recording-test-"));
  const recorder = new FakeRecorder(); let run: DesktopRunState | null = null;
  const bots = {
    state: () => run,
    start: vi.fn(async (request: unknown) => { run = { runId: "fake", status: "running", endedAt: null, ...request as object } as DesktopRunState; return run; }),
    control: vi.fn(async (action: string) => { if (run && action === "stop") { run.status = "stopped"; run.endedAt = new Date().toISOString(); } return run; })
  };
  const manager = new DesktopRecordingManager(root, bots, () => recorder, new DesktopTeachingManager(root, modelFactory)); cleanup.push({root,manager});
  return {manager,recorder,bots,root};
}
afterEach(async () => {
  for (const {root,manager} of cleanup.splice(0)) {
    await manager.close();
    const prefix = path.resolve(os.tmpdir()) + path.sep + "game-bots-recording-test-";
    if (!path.resolve(root).startsWith(prefix)) throw new Error("Unexpected test cleanup path");
    await rm(root, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

const learned = { goal: "collect one resource", targetDescription: "red object", preconditions: ["target visible"], steps: [{ name: "approach", intent: "walk toward resource", when: "object visible", success: "pickup notification", failure: "no movement", recovery: "turn around obstacle", evidenceFrames: [0, 1] }], controls: [{ id: "approach", intent: "walk forward", keys: ["KeyW"], buttons: [] }], completion: ["pickup notification"], failureIndicators: [], uncertainties: [] };
function fakeVisualModel(): VisualModel { return { provider: "fake", model: "vision-test", usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, json: vi.fn().mockResolvedValue(learned) }; }
async function captureTeaching(manager: DesktopRecordingManager, recorder: FakeRecorder, behaviorId?: string) {
  await manager.record({ target, startMethod: "button", delayMs: 0, maxDurationMs: 120000, teaching: { name: "collect", goal: "collect one resource", ...(behaviorId ? { behaviorId } : {}) } });
  recorder.frames = [0, 1].map(i => ({ png: Buffer.from(`frame-${i}`), sha256: `hash-${i}`, capturedAt: new Date().toISOString(), geometry: "g", window: target, atMs: i * 800, eventCount: i * 2, heldKeys: [], heldButtons: [] }));
  await manager.recordingControl("stop"); return manager.teaching.snapshot();
}
describe("teaching lifecycle and persistent demonstration memory", () => {
  it("attaches bounded Macro frames and original input to the draft and avoids retransmitting a known draft", async () => {
    const { manager, recorder } = await setup();
    await manager.record({ target, startMethod: "button", delayMs: 0, maxDurationMs: 120000 });
    const png = PNG.sync.write(new PNG({ width: 32, height: 24 }));
    recorder.frames = [0, 800].map((atMs, i) => ({ png, sha256: String(i).repeat(64), capturedAt: new Date().toISOString(), geometry: "g", window: target, atMs, eventCount: i * 2, heldKeys: [], heldButtons: [] }));
    const snapshot = await manager.recordingControl("stop");
    const restored = DesktopProfileSchema.parse(JSON.parse(JSON.stringify(snapshot.draft)));
    expect(restored.macro?.source).toEqual(recorder.state.events); expect(restored.macro?.frames).toHaveLength(2);
    expect(restored.macro?.frames[0]?.image).toBe(png.toString("base64")); expect(restored.macro?.width).toBe(640);
    expect(manager.snapshot(snapshot.draftId).draft).toBeNull(); expect(manager.snapshot().draft).not.toBeNull();
  });
  it("finalizes three independent teaching sessions on one recorder, through button and polled stops", async () => {
    vi.useFakeTimers(); const { manager, recorder, root } = await setup();
    const ids: string[] = []; let behaviorId: string | undefined;
    for (let session = 0; session < 3; session++) {
      await manager.record({ target, startMethod: "button", delayMs: 0, maxDurationMs: 10000, teaching: { name: "repeated", ...(behaviorId ? { behaviorId } : {}) } });
      const state = manager.teaching.snapshot(); behaviorId = state.behaviorId!; ids.push(state.demonstrationId!);
      recorder.frames = [0, 1].map(i => ({ png: Buffer.from(`session-${session}-frame-${i}`), sha256: `session-${session}-${i}`, capturedAt: new Date().toISOString(), geometry: "g", window: target, atMs: i * 800, eventCount: i * 2, heldKeys: [], heldButtons: [] }));
      if (session === 1) { await recorder.recordingCommand("stop"); await vi.advanceTimersByTimeAsync(200); await manager.behaviors(); }
      else await manager.recordingControl("stop");
      const demo = await manager.teaching.store.demonstration(ids[session]!);
      expect(demo.events).toHaveLength(2); expect(demo.frames).toHaveLength(2);
      for (const frame of demo.frames) expect(await readFile(path.join(root, "artifacts", `desktop-teach-${demo.id}`, frame.file), "utf8")).toBe(`session-${session}-frame-${frame.id}`);
      expect(recorder.closed).toBe(false);
    }
    expect(new Set(ids).size).toBe(3); expect((await manager.teaching.store.get(behaviorId!)).examples.map(e => e.demonstrationId)).toEqual(ids);
  });
  it("preserves diagnostics for a stopped session that never captured", async () => {
    const { manager, recorder } = await setup();
    await manager.record({ target, startMethod: "hotkey", teaching: { name: "not started" } });
    recorder.state.warnings = ["Capture never started: target did not gain focus"];
    await manager.recordingControl("stop");
    const demo = await manager.teaching.store.demonstration(manager.teaching.snapshot().demonstrationId!);
    expect(demo.warnings.join(" ")).toContain("never started"); expect(demo.warnings.join(" ")).toContain("fewer than two");
  });
  it("captures evidence separately from a macro, analyzes, reviews and appends further examples", async () => {
    const model = fakeVisualModel(); const { manager, recorder, bots, root } = await setup(() => model);
    const capture = await captureTeaching(manager, recorder);
    expect(manager.snapshot().draft).toBeNull(); expect(bots.start).not.toHaveBeenCalled(); expect(capture.frameCount).toBe(2);
    const demo = await manager.teaching.store.demonstration(capture.demonstrationId!);
    expect(demo.frames[0]?.eventCount).toBe(0); expect(demo.frames[1]?.eventCount).toBe(2); expect(demo.events).toHaveLength(2);
    await manager.teaching.analyze(capture.behaviorId!, capture.demonstrationId!, { outcome: "success", outcomeNote: "pickup notification" });
    await vi.waitFor(() => expect(manager.teaching.snapshot().phase).toBe("ready"));
    expect(vi.mocked(model.json).mock.calls[0]![2]).toHaveLength(2);
    await manager.teaching.review({ id: capture.behaviorId, goal: "collect one", completionOverride: "inventory increases by one", reviewed: true });
    const second = await captureTeaching(manager, recorder, capture.behaviorId!);
    expect(second.demonstrationId).not.toBe(capture.demonstrationId);
    const restarted = new DesktopTeachingManager(root);
    const stored = await restarted.store.get(capture.behaviorId!);
    expect(stored.examples).toHaveLength(2); expect(stored.examples[0]?.procedure?.targetDescription).toBe("red object");
    expect(stored.completionOverride).toBe("inventory increases by one");
    expect(await restarted.store.demonstration(capture.demonstrationId!)).toMatchObject({ outcome: "success" });
  });
  it("retains demonstration evidence when the provider is unconfigured", async () => {
    const { manager, recorder } = await setup(() => { throw new Error("Visual model is not configured"); });
    const capture = await captureTeaching(manager, recorder);
    await expect(manager.teaching.analyze(capture.behaviorId!, capture.demonstrationId!, { outcome: "success" })).rejects.toThrow(/not configured/);
    expect(manager.teaching.snapshot().phase).toBe("error");
    expect((await manager.teaching.store.demonstration(capture.demonstrationId!)).frames).toHaveLength(2);
    expect((await manager.teaching.store.get(capture.behaviorId!)).reviewed).toBe(false);
    await manager.record({ target, startMethod: "button", delayMs: 0, maxDurationMs: 120000 });
    expect((await manager.recordingControl("stop")).draft?.playback).toBe("recorded");
  });
  it("cancels analysis and disallows new input work during analysis", async () => {
    const model = fakeVisualModel(); let started = false;
    vi.mocked(model.json).mockImplementation(async (_i, _c, _images, signal) => { started = true; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); });
    const { manager, recorder, bots } = await setup(() => model); const capture = await captureTeaching(manager, recorder);
    await manager.teaching.analyze(capture.behaviorId!, capture.demonstrationId!, { outcome: "success" });
    await vi.waitFor(() => expect(started).toBe(true));
    await expect(manager.startBot({ target, profile, startMethod: "button" })).rejects.toThrow(/analysis/);
    await manager.teaching.cancelAnalysis(); expect(manager.teaching.snapshot().error).toContain("cancelled"); expect(bots.start).not.toHaveBeenCalled();
  });
  it("rejects cross-application examples and path traversal identifiers", async () => {
    const { manager, recorder } = await setup(fakeVisualModel); const capture = await captureTeaching(manager, recorder);
    await expect(manager.teaching.begin({ behaviorId: capture.behaviorId, name: "collect" }, { ...target, processName: "other" })).rejects.toThrow(/same application/);
    await expect(manager.teaching.store.get("../../outside")).rejects.toThrow();
  });
  it("finalizes a teaching capture on shutdown", async () => {
    const { manager, recorder } = await setup(fakeVisualModel);
    await manager.record({ target, startMethod: "button", delayMs: 0, maxDurationMs: 120000, teaching: { name: "collect" } });
    const id = manager.teaching.snapshot().demonstrationId!;
    await manager.close(); expect(recorder.closed).toBe(true);
    expect((await manager.teaching.store.demonstration(id)).events).toHaveLength(2);
  });
});
describe("recording versus playback orchestration (no desktop input)", () => {
  it("stopping recording converts a draft without starting the bot", async () => {
    const {manager,bots} = await setup();
    await manager.record({target,startMethod:"delay",delayMs:3000,maxDurationMs:120000});
    expect(manager.snapshot().recording?.status).toBe("countdown");
    const state = await manager.recordingControl("stop");
    expect(state.draft?.playback).toBe("recorded"); expect(state.draft?.actions[1]?.delayBeforeMs).toBe(800); expect(bots.start).not.toHaveBeenCalled();
  });
  it("cancels an armed recording and countdown before input capture", async () => {
    const {manager} = await setup();
    await manager.record({target,startMethod:"hotkey",delayMs:0,maxDurationMs:120000});
    expect(manager.snapshot().recording?.status).toBe("armed");
    await manager.recordingControl("discard"); expect(manager.snapshot().recording?.status).toBe("idle"); expect(manager.snapshot().draft).toBeNull();
  });
  it("rejects racing recording and bot starts", async () => {
    const {manager,bots} = await setup();
    const result = await Promise.allSettled([manager.record({target,startMethod:"delay",delayMs:1000,maxDurationMs:120000}),manager.startBot({target,profile,startMethod:"button"})]);
    expect(result[0]?.status).toBe("fulfilled"); expect(result[1]?.status).toBe("rejected"); expect(bots.start).not.toHaveBeenCalled();
  });
  it("arms a profile snapshot and starts it only on a bot shortcut event", async () => {
    vi.useFakeTimers(); const {manager,recorder,bots} = await setup();
    const request = {target,profile:structuredClone(profile),startMethod:"hotkey"};
    await manager.startBot(request); request.profile.name = "later edit";
    expect(bots.start).not.toHaveBeenCalled(); expect(manager.snapshot().botArmed).toBe(true);
    recorder.state.commands.push("bot"); await vi.advanceTimersByTimeAsync(200);
    expect(bots.start).toHaveBeenCalledOnce(); expect(bots.start).toHaveBeenCalledWith(expect.objectContaining({profile:expect.objectContaining({name:"demo"})}));
    expect(manager.snapshot().botArmed).toBe(false);
  });
  it("a stopped/disarmed bot cannot start on a queued stale shortcut", async () => {
    vi.useFakeTimers(); const {manager,recorder,bots} = await setup();
    await manager.startBot({target,profile,startMethod:"hotkey"}); recorder.state.commands.push("bot");
    await manager.botControl("stop"); await vi.advanceTimersByTimeAsync(200); expect(bots.start).not.toHaveBeenCalled();
  });
  it("emergency stop wins over a simultaneous queued bot start", async () => {
    vi.useFakeTimers(); const {manager,recorder,bots} = await setup();
    await manager.startBot({target,profile,startMethod:"hotkey"}); recorder.state.commands.push("bot","emergency");
    await vi.advanceTimersByTimeAsync(200); expect(bots.start).not.toHaveBeenCalled(); expect(manager.snapshot().botArmed).toBe(false);
  });
  it("reports native registration failure without arming anything", async () => {
    const {manager,recorder,bots} = await setup(); recorder.registrationError = true;
    await expect(manager.startBot({target,profile,startMethod:"hotkey"})).rejects.toThrow(/register/);
    expect(manager.snapshot().botArmed).toBe(false); expect(bots.start).not.toHaveBeenCalled(); expect(recorder.closed).toBe(true);
  });
  it("persists validated settings but never persists arming", async () => {
    const {manager,root,bots} = await setup();
    const keys = DesktopHotkeysSchema.parse({record:"F5",bot:"F7",stopRecording:"F9"});
    await manager.saveSettings(keys); await manager.startBot({target,profile,startMethod:"hotkey"}); await manager.close();
    const restarted = new DesktopRecordingManager(root,bots,()=>new FakeRecorder());
    expect(await restarted.settings()).toEqual(keys); expect(restarted.snapshot().botArmed).toBe(false); await restarted.close();
  });
  it("rejects playback of reserved control keys and conflicting assignments", async () => {
    const {manager,bots} = await setup();
    await expect(manager.saveSettings({record:"F6",bot:"F6",stopRecording:"F9"})).rejects.toThrow();
    await expect(manager.startBot({target,startMethod:"button",profile:{...profile,actions:[{kind:"key-down",key:"F6"}]}})).rejects.toThrow(/control hotkey/);
    expect(bots.start).not.toHaveBeenCalled();
  });
  it("does not regenerate a stopped recording over an edited draft on later emergencies", async () => {
    vi.useFakeTimers(); const {manager,recorder} = await setup();
    await manager.record({target,startMethod:"button",delayMs:0,maxDurationMs:120000}); await manager.recordingControl("stop");
    const id=manager.snapshot().draftId; recorder.state.revision++; recorder.state.commands.push("emergency"); await vi.advanceTimersByTimeAsync(200);
    expect(manager.snapshot().draftId).toBe(id);
  });
});
