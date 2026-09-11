import { describe, it, expect, vi, afterEach } from "vitest";
import { DesktopRunner, type DesktopPolicy } from "../src/application/desktop-runner.js";
import { DesktopProfileSchema } from "@game-bots/game-sdk";
import type { DesktopAction, DesktopHealth, DesktopObservation, DesktopSession, DesktopWindow } from "@game-bots/environment-sdk";
import type { ArtifactStore } from "@game-bots/runtime-core";

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
  async listWindows() { return [target]; }
  async bind() {}
  async focus() {}
  async resume() { this.armed = true; this.reason = null; }
  async pause() { this.armed = false; this.reason = "Paused"; await this.releaseAll(); }
  async releaseAll() { this.held.clear(); }
  async close() { await this.releaseAll(); this.closed = true; }
  async health(): Promise<DesktopHealth> { return { armed: this.armed, reason: this.reason, heldKeys: [...this.held], heldButtons: [] }; }
  async observe(): Promise<DesktopObservation> {
    if (this.failCapture) throw new Error("capture failed");
    this.captures++; return { capturedAt: new Date().toISOString(), window: target, geometry: "same", png: Buffer.from("png"), sha256: String(this.changed ? this.captures : 0) };
  }
  async execute(action: DesktopAction, _geometry: string, signal: AbortSignal) {
    signal.throwIfAborted(); this.actions.push(action);
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
});
