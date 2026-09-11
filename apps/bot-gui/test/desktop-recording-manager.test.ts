import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopRecordingManager } from "../src/desktop-recording-manager.js";
import { DesktopHotkeysSchema, type DesktopRecorder, type RecordingOptions, type RecordingState, type DesktopHotkeys } from "@game-bots/environment-sdk";
import { DesktopProfileSchema } from "@game-bots/game-sdk";
import type { DesktopRunState } from "@game-bots/agent-player";

const target = { handle: "123", pid: 12, processStartedAt: "1", title: "Owned fixture", processName: "fixture", dpi: 96, bounds: { x: -200, y: 0, width: 640, height: 480 } };
const profile = DesktopProfileSchema.parse({ version: 1, name: "demo", startDelayMs: 500, actions: [{ kind: "key-down", key: "KeyW" }] });
class FakeRecorder implements DesktopRecorder {
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
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "game-bots-recording-test-"));
  const recorder = new FakeRecorder(); let run: DesktopRunState | null = null;
  const bots = {
    state: () => run,
    start: vi.fn(async (request: unknown) => { run = { runId: "fake", status: "running", endedAt: null, ...request as object } as DesktopRunState; return run; }),
    control: vi.fn(async (action: string) => { if (run && action === "stop") { run.status = "stopped"; run.endedAt = new Date().toISOString(); } return run; })
  };
  const manager = new DesktopRecordingManager(root, bots, () => recorder); cleanup.push({root,manager});
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
