import { describe, expect, it, vi, afterEach } from "vitest";
import { LearnedDesktopPolicy } from "../src/vision/learned-desktop-policy.js";
import { learnDemonstration, selectTeachingFrames } from "../src/vision/demonstration-learning.js";
import { LearnedBehaviorSchema, type Demonstration } from "@game-bots/game-sdk";
import type { DesktopDecisionContext } from "../src/application/desktop-runner.js";
import type { VisualModel } from "../src/vision/visual-model.js";

const demoId = "22222222-2222-4222-8222-222222222222";
const procedure = { goal: "Collect a red item", targetDescription: "red item", preconditions: ["item visible"],
  steps: [{ name: "approach", intent: "approach the target", when: "target visible", success: "pickup notification", failure: "blocked", recovery: "turn and retry", evidenceFrames: [0, 1] }],
  controls: [{ id: "approach", intent: "walk toward visible target", keys: ["KeyW"], buttons: [] }], completion: ["pickup notification"], failureIndicators: ["blocked"], uncertainties: [] };
const behavior = LearnedBehaviorSchema.parse({ version: 1, id: "11111111-1111-4111-8111-111111111111", name: "collect", goal: "collect one", processName: "fixture", cameraMode: "pointer", completionOverride: "pickup notification visible", reviewed: true, updatedAt: "now",
  examples: [{ demonstrationId: demoId, outcome: "success", procedure, analyzedAt: "now", model: "fake", provider: "test" }] });
function context(png = "current-right"): DesktopDecisionContext {
  return { goal: behavior.goal, observation: { png: Buffer.from(png), sha256: png, capturedAt: new Date().toISOString(), geometry: "g", window: { handle: "1", pid: 1, processStartedAt: "1", title: "fixture", processName: "fixture", dpi: 96, bounds: { x: 0, y: 0, width: 800, height: 600 } } },
    history: [], skills: [], actionsRemaining: 100, elapsedMs: 0 };
}
function model(...responses: unknown[]): VisualModel {
  const result = { provider: "fake", model: "vision", usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 }, json: vi.fn() };
  result.json.mockImplementation(async () => { const index = result.usage.calls++; return responses[Math.min(index, responses.length - 1)]; }); return result;
}
function decision(action: unknown = { kind: "control", controlId: `${demoId}:approach`, durationMs: 500 }, changes = {}) {
  return { status: "Approaching", evidence: "Target visible", progress: "progress", outcome: "act", action, ...changes };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe("demonstration guided policy", () => {
  it("grounds different clicks in current screenshots, includes demonstration memory and before/action history", async () => {
    const m = model(decision({ kind: "click", point: { x: .8, y: .4 }, button: "left" }), decision({ kind: "click", point: { x: .2, y: .7 }, button: "left" }));
    const p = new LearnedDesktopPolicy(m, behavior, [{ label: "reference", png: Buffer.from("historical-left") }]);
    const first = context(); const a = await p.decide(first, signal()); await p.verify(first, first.observation);
    const b = await p.decide(context("current-left"), signal());
    expect(a).toMatchObject({ actions: [{ kind: "click", point: { x: .8, y: .4 } }] });
    expect(b).toMatchObject({ actions: [{ kind: "click", point: { x: .2, y: .7 } }] });
    const calls = vi.mocked(m.json).mock.calls;
    expect(calls[1]![2].at(-1)?.png.toString()).toBe("current-left");
    expect(calls[1]![2].at(-2)?.png.toString()).toBe("current-right");
    expect(JSON.stringify(calls[0]![1])).toContain("approach the target");
    expect(m.usage.calls).toBe(2); // verify reuses the next decision, no extra call
  });
  it("expands a named control into a short bounded hold with live duration", async () => {
    const p = new LearnedDesktopPolicy(model(decision()), behavior, []);
    expect(await p.decide(context(), signal())).toMatchObject({ type: "act", actions: [{ kind: "hold", keys: ["KeyW"], durationMs: 500 }] });
  });
  it.each([
    { kind: "shell", command: "anything" },
    { kind: "control", controlId: "invented", durationMs: 500 },
    { kind: "control", controlId: `${demoId}:approach`, durationMs: 1500 },
    { kind: "click", point: { x: 1.2, y: .5 }, button: "left" },
    { kind: "camera", dx: 10, dy: 0, controlId: null }
  ])("rejects unsupported, invented or excessive action %j", async action => {
    await expect(new LearnedDesktopPolicy(model(decision(action)), behavior, []).decide(context(), signal())).rejects.toThrow();
  });
  it("requires two model observations of completion and clears confirmation on pause", async () => {
    const p = new LearnedDesktopPolicy(model(decision(null, { outcome: "complete", evidence: "Inventory increased" })), behavior, []);
    expect(await p.decide(context(), signal())).toMatchObject({ type: "act", reason: expect.stringContaining("Verifying") });
    p.reset(); expect(await p.decide(context(), signal())).toMatchObject({ type: "act" });
    expect(await p.decide(context(), signal())).toMatchObject({ type: "complete", reason: expect.stringContaining("Inventory increased") });
  });
  it("stops on uncertainty, repeated no progress and exhausted model budget", async () => {
    const m = model(decision(undefined, { progress: "unknown" })); const p = new LearnedDesktopPolicy(m, behavior, [], { maxNoProgress: 2 });
    const c = context(); c.history = [{ action: { kind: "wait", durationMs: 100 }, before: "a", after: "b", screenChanged: true, verification: "unknown", reason: "" }];
    expect(await p.decide(c, signal())).toMatchObject({ type: "act" });
    expect(await p.decide(c, signal())).toMatchObject({ type: "stop", reason: expect.stringContaining("Stuck") });
    const limited = new LearnedDesktopPolicy(m, behavior, [], { maxCalls: 2 });
    expect(await limited.decide(context(), signal())).toMatchObject({ type: "stop", reason: expect.stringContaining("budget") });
    expect(m.usage.calls).toBe(2);
  });
  it("allows bounded recovery then stops when its budget is exhausted", async () => {
    const p = new LearnedDesktopPolicy(model(decision(undefined, { outcome: "recover" })), behavior, [], { maxRecoveries: 1 });
    expect(await p.decide(context(), signal())).toMatchObject({ type: "act" });
    expect(await p.decide(context(), signal())).toMatchObject({ type: "stop", reason: expect.stringContaining("Recovery budget") });
  });
  it("rejects stale observations and ignores a late response after cancellation", async () => {
    const m = model(decision()); const stale = context(); stale.observation.capturedAt = new Date(Date.now() - 20000).toISOString();
    await expect(new LearnedDesktopPolicy(m, behavior, []).decide(stale, signal())).rejects.toThrow(/too old/);
    const controller = new AbortController(); vi.mocked(m.json).mockImplementation(async () => { controller.abort(); return decision(); });
    await expect(new LearnedDesktopPolicy(m, behavior, []).decide(context(), controller.signal)).rejects.toThrow();
  });
  it("retains variation from multiple successful examples alongside failed-example guidance", async () => {
    const b = structuredClone(behavior);
    b.examples.push({ ...b.examples[0]!, demonstrationId: "33333333-3333-4333-8333-333333333333", procedure: { ...procedure, targetDescription: "viewed from another angle" } });
    b.examples.push({ ...b.examples[0]!, demonstrationId: "44444444-4444-4444-8444-444444444444", outcome: "failure" });
    const m = model(decision()); await new LearnedDesktopPolicy(m, b, []).decide(context(), signal());
    expect(JSON.stringify(vi.mocked(m.json).mock.calls[0]![1])).toContain("viewed from another angle");
    expect((vi.mocked(m.json).mock.calls[0]![1] as { examples: unknown[] }).examples).toHaveLength(3);
  });
});

describe("visual demonstration distillation", () => {
  const demo: Demonstration = { version: 1, id: demoId, behaviorId: behavior.id, name: "collect", goal: "collect one", cameraMode: "pointer", target: context().observation.window,
    createdAt: "now", endedAt: "now", outcome: "success", outcomeNote: "Inventory increased", captureReason: "stopped", warnings: [],
    events: [{ atMs: 50, action: { kind: "key-down", key: "KeyW" } }, { atMs: 500, action: { kind: "key-up", key: "KeyW" } }],
    frames: [0, 1].map(id => ({ id, atMs: id * 500, capturedAt: "now", eventCount: id * 2, geometry: "g", sha256: String(id), file: `frames/${id}.png`, heldKeys: [], heldButtons: [] })) };
  it("requires valid visual evidence and controls observed in the demonstration", async () => {
    expect(await learnDemonstration(model(procedure), { demonstration: demo, images: [] }, signal())).toEqual(procedure);
    await expect(learnDemonstration(model({ ...procedure, controls: [{ id: "invented", intent: "not seen", keys: ["KeyX"], buttons: [] }] }), { demonstration: demo, images: [] }, signal())).rejects.toThrow(/undemonstrated/);
    await expect(learnDemonstration(model({ ...procedure, steps: [{ ...procedure.steps[0], evidenceFrames: [99] }] }), { demonstration: demo, images: [] }, signal())).rejects.toThrow(/missing visual evidence/);
  });
  it("samples a long demonstration with bounded image count and both endpoints", () => {
    const long = { ...demo, frames: Array.from({ length: 150 }, (_, id) => ({ ...demo.frames[0]!, id, atMs: id * 800 })) };
    const selected = selectTeachingFrames(long); expect(selected).toHaveLength(12); expect(selected[0]?.id).toBe(0); expect(selected.at(-1)?.id).toBe(149);
  });
});
