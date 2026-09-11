import { describe, it, expect, vi, afterEach } from "vitest";
import { DesktopRunner, type DesktopPolicy } from "../src/application/desktop-runner.js";
import { DesktopProfileSchema } from "@game-bots/game-sdk";
import type { DesktopAction, DesktopHealth, DesktopObservation, DesktopSession, DesktopWindow } from "@game-bots/environment-sdk";
import type { ArtifactStore } from "@game-bots/runtime-core";
vi.mock("node:perf_hooks", () => ({ performance: { now: () => Date.now() } }));

// timers/promises retains native timers; use abortable global timers under Vitest's clock.
vi.mock("node:timers/promises", () => ({ setTimeout: (ms: number, value: unknown, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
  const signal = options?.signal;
  if (signal?.aborted) { reject(signal.reason); return; }
  const onAbort = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(value); }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
}) }));

const target: DesktopWindow = { handle: "123", pid: 456, processStartedAt: "1", processName: "fixture", title: "fixture", bounds: { x: -100, y: 20, width: 640, height: 480 }, dpi: 144 };
class FakeDesktop implements DesktopSession {
  held = new Set<string>(); closed = false; armed = false; reason: string | null = null;
  actions: DesktopAction[] = []; captures = 0; failCapture = false; changed = true;
  dispatchTimes: number[] = []; releases = 0;
  async listWindows() { return [target]; }
  async bind() {}
  async focus() {}
  async resume() { this.armed = true; this.reason = null; }
  async pause() { this.armed = false; this.reason = "Paused"; await this.releaseAll(); }
  async releaseAll() { this.held.clear(); this.releases++; }
  async close() { await this.releaseAll(); this.closed = true; }
  async health(): Promise<DesktopHealth> { return { armed: this.armed, reason: this.reason, heldKeys: [...this.held], heldButtons: [] }; }
  async observe(): Promise<DesktopObservation> {
    if (this.failCapture) throw new Error("capture failed");
    this.captures++; return { capturedAt: new Date().toISOString(), window: target, geometry: "same", png: Buffer.from("png"), sha256: String(this.changed ? this.captures : 0) };
  }
  async execute(action: DesktopAction, _geometry: string, signal: AbortSignal) {
    signal.throwIfAborted(); this.actions.push(action); this.dispatchTimes.push(Date.now());
    if (action.kind === "key-down") this.held.add(action.key);
    if (action.kind === "key-up") this.held.delete(action.key);
  }
}
function setup(overrides: object = {}, policy?: DesktopPolicy) {
  const session = new FakeDesktop(); const documents: Record<string, string> = {};
  const artifacts: ArtifactStore = {
    async put(meta, payload) { documents[meta.relativePath] = String(payload); return { artifactId: "1", runId: meta.runId, kind: meta.kind, relativePath: meta.relativePath, byteLength: 3, createdAt: new Date().toISOString(), contentType: meta.contentType }; },
    get: vi.fn(), exists: vi.fn()
  };
  const profile = DesktopProfileSchema.parse({ version: 1, name: "test", startDelayMs: 0, intervalMs: 100, maxActions: 2, maxDurationMs: 10000, actions: [{ kind: "key-down", key: "KeyW" }], ...overrides });
  return { session, documents, runner: new DesktopRunner(session, artifacts, target, profile, policy) };
}
afterEach(() => vi.useRealTimers());
describe("desktop bounded runner", () => {
  it("pauses for local teaching with no dispatch and checkpoints after releasing input", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { local: true, boundedBatch: true, decide: vi.fn().mockResolvedValue({ type: "pause", reason: "Unknown state: teach" }), verify: vi.fn(), checkpoint: vi.fn(), close: vi.fn() };
    const { runner, session } = setup({ mode: "local" }, policy); const task = runner.start(); await vi.advanceTimersByTimeAsync(400);
    expect(runner.state.status).toBe("paused"); expect(session.actions).toHaveLength(0); expect(session.held.size).toBe(0); expect(policy.checkpoint).toHaveBeenCalledOnce();
    await runner.stop(); await task; expect(policy.close).toHaveBeenCalledOnce();
  });
  it("rejects a moved local target and changed completion appearance before accepting a decision", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { local: true, decide: vi.fn().mockResolvedValue({ type: "complete", reason: "Candidate" }), verify: vi.fn(), validateObservation: vi.fn().mockResolvedValue(false) };
    const { runner, session } = setup({ mode: "local" }, policy); const task = runner.start(); await vi.advanceTimersByTimeAsync(400);
    expect(runner.state.status).toBe("paused"); expect(session.actions).toHaveLength(0); await runner.stop(); await task;
  });
  it("bounds local report events and retains compact evidence under many fake decisions", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { local: true, boundedBatch: true, managesProgress: true, decide: vi.fn().mockResolvedValue({ type: "act", reason: "Synthetic transition", actions: [{ kind: "wait", durationMs: 1 }] }), verify: vi.fn().mockResolvedValue({ result: "unknown", reason: "Synthetic" }) };
    const { runner, documents } = setup({ mode: "local", maxActions: 200, maxDurationMs: 60000 }, policy); const task = runner.start(); await vi.runAllTimersAsync(); await task;
    const report = JSON.parse(documents["reports/desktop-summary.json"]!); expect(report.events.length).toBeLessThanOrEqual(500); expect(report.droppedEvents).toBeGreaterThan(0); expect(report.history.length).toBeLessThanOrEqual(20); expect(report.logs.length).toBeLessThanOrEqual(100); expect(report.evidence.length).toBeLessThanOrEqual(16);
  });
  it("replays recorded timestamps without inserting screenshot/interval delays between edges", async () => {
    vi.useFakeTimers();
    const { runner, session } = setup({ playback: "recorded", loop: { mode: "once" }, maxActions: 20, actions: [
      { kind: "key-down", key: "KeyW", delayBeforeMs: 0 }, { kind: "key-down", key: "Space", delayBeforeMs: 800 },
      { kind: "key-up", key: "Space", delayBeforeMs: 100 }, { kind: "key-up", key: "KeyW", delayBeforeMs: 500 }
    ] });
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(session.dispatchTimes.map(t => t - session.dispatchTimes[0]!)).toEqual([0,800,900,1400]);
    expect(session.captures).toBe(2); expect(runner.state.completedLoops).toBe(1); expect(session.held.size).toBe(0);
  });
  it("applies the initial countdown once and a separate delay between finite loops", async () => {
    vi.useFakeTimers(); const start = Date.now();
    const { runner, session } = setup({ playback: "recorded", startDelayMs: 500, maxActions: 20, loop: { mode: "count", count: 3, delayMs: 300 }, actions: [{ kind: "key-down", key: "KeyW", delayBeforeMs: 100 }] });
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(session.dispatchTimes.map(t=>t-start)).toEqual([800,1200,1600]); expect(runner.state.completedLoops).toBe(3);
    expect(session.releases).toBeGreaterThanOrEqual(3); expect(runner.state.status).toBe("completed");
  });
  it("bounds until-stopped looping by the existing action cap", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ playback: "recorded", loop: { mode: "until-stopped" }, maxActions: 5 });
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(session.actions).toHaveLength(5); expect(runner.state.reason).toBe("Action limit reached"); expect(session.held.size).toBe(0);
  });
  it("preserves the remaining loop delay while paused", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ playback: "recorded", loop: { mode: "count", count: 2, delayMs: 1000 }, maxActions: 10 });
    const task = runner.start(); await vi.advanceTimersByTimeAsync(400); await runner.pause();
    await vi.advanceTimersByTimeAsync(500); const resume = runner.resume(); await vi.advanceTimersByTimeAsync(250); await resume;
    await vi.runAllTimersAsync(); await task;
    expect(session.dispatchTimes[1]! - session.dispatchTimes[0]!).toBe(1700);
    expect(runner.state.completedLoops).toBe(2); expect(session.held.size).toBe(0);
  });
  it("retains timing for disabled events without dispatching them", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ playback: "recorded", loop: { mode: "once" }, maxActions: 10, actions: [
      { kind: "key-down", key: "KeyW", delayBeforeMs: 100, enabled: false }, { kind: "key-down", key: "Space", delayBeforeMs: 300 }
    ] }); const start = Date.now(); const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(session.actions).toHaveLength(1); expect(session.dispatchTimes[0]! - start).toBe(600);
  });
  it("adds an inserted wait to the recorded timeline before subsequent event gaps", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ playback: "recorded", loop: { mode: "once" }, maxActions: 10, actions: [
      { kind: "key-down", key: "KeyW", delayBeforeMs: 0 }, { kind: "wait", durationMs: 1000, delayBeforeMs: 100 }, { kind: "key-up", key: "KeyW", delayBeforeMs: 200 }
    ] });
    const execute = session.execute.bind(session);
    session.execute = async (action, geometry, signal) => { await execute(action, geometry, signal); if (action.kind === "wait") await new Promise(resolve => setTimeout(resolve, action.durationMs)); };
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(session.dispatchTimes.map(t => t - session.dispatchTimes[0]!)).toEqual([0, 100, 1300]);
    expect(session.held.size).toBe(0);
  });
  it("releases held input when a timed loop is stopped partway through", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ playback: "recorded", loop: { mode: "until-stopped" }, maxActions: 10, actions: [
      { kind: "key-down", key: "KeyW", delayBeforeMs: 0 }, { kind: "key-up", key: "KeyW", delayBeforeMs: 2000 }
    ] }); const task = runner.start(); await vi.advanceTimersByTimeAsync(350); expect(session.held.size).toBe(1);
    await runner.stop(); await task; expect(session.held.size).toBe(0); expect(session.actions).toHaveLength(1); expect(runner.state.status).toBe("stopped");
  });
  it("restores held state only after explicit resume and excludes paused time from recorded timing", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ playback: "recorded", loop: { mode: "once" }, maxActions: 10, actions: [
      { kind: "key-down", key: "KeyW", delayBeforeMs: 0 }, { kind: "key-up", key: "KeyW", delayBeforeMs: 1000 }
    ] }); const task = runner.start(); await vi.advanceTimersByTimeAsync(400); await runner.pause(); expect(session.held.size).toBe(0);
    await vi.advanceTimersByTimeAsync(500); const resume = runner.resume(); await vi.advanceTimersByTimeAsync(250); await resume;
    await vi.runAllTimersAsync(); await task;
    expect(session.actions.map(a=>a.kind)).toEqual(["key-down","key-down","key-up"]);
    expect(session.dispatchTimes[2]! - session.dispatchTimes[0]!).toBe(1700); expect(session.held.size).toBe(0);
  });
  it("observes before/after, bounds attempts, preserves recent history, and releases held input", async () => {
    vi.useFakeTimers(); const { runner, session, documents } = setup();
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("completed"); expect(session.actions).toHaveLength(2);
    expect(session.captures).toBe(4); expect(session.held.size).toBe(0); expect(session.closed).toBe(true);
    expect(runner.state.history[0]).toMatchObject({ screenChanged: true, verification: "unknown" });
    expect(JSON.parse(documents["reports/desktop-summary.json"]!)).toMatchObject({ status: "completed", actionCount: 2 });
  });
  it("stops during the start delay without sending an action", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ startDelayMs: 3000 }); const task = runner.start();
    await vi.advanceTimersByTimeAsync(10); await runner.stop(); await task;
    expect(session.actions).toHaveLength(0); expect(runner.state.status).toBe("stopped"); expect(session.closed).toBe(true);
  });
  it("pauses, releases held state, then resumes with a fresh capture", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ maxActions: 4 }); const task = runner.start();
    await vi.advanceTimersByTimeAsync(220); expect(session.held.size).toBe(1);
    await runner.pause(); expect(session.held.size).toBe(0); const count = session.actions.length;
    await vi.advanceTimersByTimeAsync(500); expect(session.actions.length).toBe(count);
    const resume = runner.resume(); await vi.advanceTimersByTimeAsync(210); await resume;
    await vi.runAllTimersAsync(); await task; expect(session.actions.length).toBe(4); expect(session.closed).toBe(true);
  });
  it("enforces wall duration while paused", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ maxDurationMs: 1000, maxActions: 100 }); const task = runner.start();
    await vi.advanceTimersByTimeAsync(220); await runner.pause(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("stopped"); expect(runner.state.reason).toContain("duration limit"); expect(session.held.size).toBe(0);
  });
  it("fails closed when observation fails after input", async () => {
    vi.useFakeTimers(); const { runner, session } = setup(); const task = runner.start();
    await vi.advanceTimersByTimeAsync(220); session.failCapture = true; await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("failed"); expect(runner.state.actionCount).toBe(1); expect(session.held.size).toBe(0);
  });
  it("stops on target loss without retrying input", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ maxActions: 100 }); const task = runner.start();
    await vi.advanceTimersByTimeAsync(220); session.armed = false; session.reason = "Target window lost, hidden, or minimized";
    await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("failed"); expect(session.actions).toHaveLength(1); expect(session.held.size).toBe(0);
  });
  it("pauses on focus loss instead of stealing focus", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ maxActions: 100 }); const focus = vi.spyOn(session, "focus"); const task = runner.start();
    await vi.advanceTimersByTimeAsync(220); session.armed = false; session.reason = "Target focus lost";
    await vi.advanceTimersByTimeAsync(200); expect(runner.state.status).toBe("paused"); expect(focus).toHaveBeenCalledTimes(1);
    await runner.stop(); await task;
  });
  it("pauses on configured unchanged-screen limit without claiming no goal progress", async () => {
    vi.useFakeTimers(); const { runner, session } = setup({ maxUnchangedObservations: 1 }); session.changed = false; const task = runner.start();
    await vi.advanceTimersByTimeAsync(350); expect(runner.state.status).toBe("paused"); expect(runner.state.history[0]?.verification).toBe("unknown");
    await runner.stop(); await task;
  });
  it("requires an explicit feedback provider", () => { expect(() => setup({ mode: "feedback" })).toThrow(/requires/); });
  it("passes goal, distinct before/after screenshots and history to the policy; resolves configured skills", async () => {
    vi.useFakeTimers();
    const policy: DesktopPolicy = {
      decide: vi.fn().mockResolvedValueOnce({ type: "skill", skillId: "move", reason: "Test the mapping" }).mockResolvedValue({ type: "complete", reason: "Verified" }),
      verify: vi.fn().mockResolvedValue({ result: "progress", reason: "Test policy evidence" })
    };
    const { runner, session } = setup({ mode: "feedback", goal: "Reach the marker", maxActions: 5, skills: [{ id: "move", description: "move", actions: [{ kind: "key-down", key: "KeyW" }] }] }, policy);
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("completed"); expect(policy.decide).toHaveBeenCalledWith(expect.objectContaining({ goal: "Reach the marker" }), expect.any(AbortSignal));
    const [context, before] = vi.mocked(policy.verify).mock.calls[0]!;
    expect(context.observation.sha256).not.toBe(before.sha256); expect(runner.state.history[0]?.verification).toBe("progress"); expect(session.held.size).toBe(0);
  });
  it("bounds a non-cooperative policy and sends no input after cancellation", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { decide: () => new Promise(() => {}), verify: vi.fn() };
    const { runner, session } = setup({ mode: "feedback", maxDurationMs: 1000 }, policy); const task = runner.start();
    await vi.runAllTimersAsync(); await task; expect(session.actions).toHaveLength(0); expect(session.closed).toBe(true); expect(runner.state.status).toBe("stopped");
  });
  it("rejects malformed provider output before input", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { decide: vi.fn().mockResolvedValue({ type: "act", actions: [{ kind: "shell", command: "bad" }], reason: "bad" }), verify: vi.fn() };
    const { runner, session } = setup({ mode: "feedback" }, policy); const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("failed"); expect(session.actions).toHaveLength(0);
  });
  it("runs a bounded batch without observing or reasoning while a button is held, then cleans up", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { boundedBatch: true,
      decide: vi.fn().mockResolvedValueOnce({ type: "act", actions: [{ kind: "key-down", key: "KeyW" }, { kind: "relative-move", dx: 10, dy: 0 }, { kind: "release-all" }], reason: "Adjusting approach" }).mockResolvedValue({ type: "complete", reason: "Visible success" }),
      verify: vi.fn().mockResolvedValue({ result: "progress", reason: "visible progress" }) };
    const { runner, session } = setup({ mode: "feedback", maxActions: 10 }, policy);
    const observe = session.observe.bind(session); session.observe = async () => { expect(session.held.size).toBe(0); return observe(); };
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(session.actions).toHaveLength(3); expect(runner.state.status).toBe("completed"); expect(session.closed).toBe(true);
    expect(runner.state.history[0]?.actions).toHaveLength(3);
  });
  it("does not call action-budget exhaustion a successful feedback run", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { boundedBatch: true, decide: vi.fn().mockResolvedValue({ type: "act", actions: [{ kind: "wait", durationMs: 100 }], reason: "Searching" }), verify: vi.fn().mockResolvedValue({ result: "unknown", reason: "awaiting" }) };
    const { runner } = setup({ mode: "feedback", maxActions: 1 }, policy); const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("stopped"); expect(runner.state.reason).toContain("goal not verified");
  });
  it("checks target health before accepting model completion", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { decide: vi.fn(), verify: vi.fn() };
    const { runner, session } = setup({ mode: "feedback" }, policy);
    vi.mocked(policy.decide).mockImplementation(async () => { session.reason = "Target identity changed"; session.armed = false; return { type: "complete", reason: "incorrect" }; });
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("failed"); expect(session.actions).toHaveLength(0); expect(session.closed).toBe(true);
  });
  it("cleans up held input after a bounded batch fails midway", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { boundedBatch: true, decide: vi.fn().mockResolvedValue({ type: "act", actions: [{ kind: "key-down", key: "KeyW" }, { kind: "relative-move", dx: 1, dy: 0 }], reason: "Move" }), verify: vi.fn() };
    const { runner, session } = setup({ mode: "feedback", maxActions: 10 }, policy);
    const execute = session.execute.bind(session); session.execute = async (a, g, s) => { if (a.kind === "relative-move") throw new Error("Input rejected"); await execute(a, g, s); };
    const task = runner.start(); await vi.runAllTimersAsync(); await task;
    expect(runner.state.status).toBe("failed"); expect(session.held.size).toBe(0); expect(session.closed).toBe(true);
  });
  it("bounds model latency independently of the run deadline", async () => {
    vi.useFakeTimers(); const policy: DesktopPolicy = { decide: () => new Promise(() => {}), verify: vi.fn() };
    const { runner, session } = setup({ mode: "feedback", maxDurationMs: 10000, policyTimeoutMs: 1000 }, policy);
    const task = runner.start(); await vi.advanceTimersByTimeAsync(1300); await task;
    expect(runner.state.reason).toContain("Policy timed out"); expect(session.closed).toBe(true);
  });
});
