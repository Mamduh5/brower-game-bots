import { describe, it, expect } from "vitest";
import { LocalRunOptionsSchema } from "@game-bots/game-sdk";
import { decodeGrid, features, similarity, patchAt, matchTarget } from "../src/local/vision.js";
import { LocalEngine, recordResult, actionScore } from "../src/local/engine.js";
import { importDemonstration, frameSkill } from "../src/local/training.js";
import { clearRuntime, forgetDemonstration, LOCAL_LIMITS, LocalMemorySchema, newMemory } from "../src/local/memory.js";
import { behavior, demonstration, memoryFixture, scene, sha, state } from "./local-fixtures.js";

describe("local visual features and grounding", () => {
  it("tolerates minor brightness and target translation while separating unrelated scenes", () => {
    const image = decodeGrid(scene()), base = features(image), light = features({ rgb: image.rgb.map(v => Math.min(1, v + .02)) });
    expect(similarity(base, light)).toBeGreaterThan(.9); expect(similarity(base, state(2))).toBeLessThan(.5);
    expect(similarity(features(decodeGrid(scene(0, 24))), features(decodeGrid(scene(0, 60))))).toBeGreaterThan(.85);
  });
  it("grounds a textured target at new coordinates", () => {
    const target = patchAt(decodeGrid(scene(0, 24)), .25, .5, .125, 1 / 6)!;
    expect(target).not.toBeNull(); const match = matchTarget(decodeGrid(scene(0, 60)), target);
    expect(match).not.toBeNull(); expect(match!.x).toBeCloseTo(.625, 1); expect(match!.confidence).toBeGreaterThan(.78);
  });
  it("rejects featureless patches, absent targets and duplicate ambiguous matches", () => {
    const target = patchAt(decodeGrid(scene(0, 24)), .25, .5, .125, 1 / 6)!;
    expect(patchAt({ rgb: new Array(96 * 72 * 3).fill(.4) }, .5, .5)).toBeNull();
    expect(matchTarget(decodeGrid(scene(2)), target)).toBeNull();
    expect(matchTarget(decodeGrid(scene(0, 24, true)), target)).toBeNull();
    const colored = { rgb: Array.from({ length: 96 * 72 * 3 }, (_, i) => [.1, .9, .2][i % 3]!) };
    expect(patchAt(colored, .5, .5)).toBeNull();
    expect(matchTarget(colored, target)).toBeNull();
  });
  it("validates PNG headers and decoded pixel budgets before allocation", () => {
    expect(() => decodeGrid(Buffer.from("broken"))).toThrow(); const png = Buffer.from(scene()); png.writeUInt32BE(1000000, 16); expect(() => decodeGrid(png)).toThrow(/megapixels/);
  });
  it("limits the feature representation to the annotated region", () => {
    const a = decodeGrid(scene()), b = { rgb: a.rgb.slice() }; for (let i = 96 * 36 * 3; i < b.rgb.length; i++) b.rgb[i] = 1;
    const region = { x: 0, y: 0, width: 1, height: .5 };
    expect(similarity(features(a, region), features(b, region))).toBe(1);
  });
});
describe("local imitation and online updates", () => {
  function grounded() {
    const { m, transition: t } = memoryFixture();
    const patch = patchAt(decodeGrid(scene(0, 24)), .25, .5, .125, 1 / 6)!;
    m.targets.push({ id: "target", ...patch });
    t.targetId = "target"; t.targetBefore = { x: .25, y: .5 }; t.targetAfter = { x: 1 / 3, y: .5 };
    t.before = features(decodeGrid(scene(0, 24))); t.after = features(decodeGrid(scene(0, 32))); t.terminal = false;
    return { m, t };
  }
  it("does not reward passing the demonstrated endpoint even when target motion has the right direction", () => {
    const { m } = grounded(), e = new LocalEngine(m), before = scene(0, 24), after = scene(0, 60);
    expect(e.decide(before, sha(before)).type).toBe("act");
    expect(e.verify(after, sha(after)).result).toBe("no-progress");
    expect(e.telemetry().assessment?.target?.alignment).toBeGreaterThan(.8);
    expect(m.totals.negative).toBe(1);
  });
  it("credits approach but penalizes unexpected target loss despite a matching scene result", () => {
    const { m, t } = grounded(), e = new LocalEngine(m), before = scene(0, 24), after = scene(0, 32);
    e.decide(before, sha(before)); expect(e.verify(after, sha(after)).result).toBe("progress");
    t.after = state(1); e.decide(before, sha(before));
    expect(e.verify(scene(1), sha(scene(1))).result).toBe("no-progress");
    expect(e.telemetry().assessment?.target?.after).toBeNull();
  });
  it("rejects directional controls unsupported by the current target position", () => {
    const { m } = grounded(), e = new LocalEngine(m), png = scene(0, 60);
    expect(e.decide(png, sha(png)).type).toBe("pause");
    expect(e.telemetry().candidates[0]?.rejection).toContain("control support");
  });
  it("bounds total compound duration and shortens controls with fast demonstrated target motion", () => {
    const { m, t } = grounded();
    t.actions = [{ kind: "hold", keys: ["KeyW"], buttons: [], durationMs: 400 }, { kind: "hold", keys: ["KeyD"], buttons: [], durationMs: 400 }];
    const e = new LocalEngine(m, { maxActionMs: 600 }), png = scene(0, 24), decision = e.decide(png, sha(png));
    expect(decision.type).toBe("act"); expect(e.telemetry().actionBudgetMs).toBeLessThanOrEqual(336);
    expect(e.telemetry().actionBudgetMs).toBeGreaterThanOrEqual(120);
    t.actions = [1, 1, 798].map(durationMs => ({ kind: "hold", keys: ["KeyW"], buttons: [], durationMs }));
    const short = new LocalEngine(m, { maxActionMs: 100 }); short.decide(png, sha(png));
    expect(short.telemetry().actionBudgetMs).toBeLessThanOrEqual(100);
  });
  it("keeps ordinary candidates when recovery examples exist but do not match the current scene", () => {
    const { m, transition } = memoryFixture();
    m.transitions.push({ ...structuredClone(transition), id: "unrelated-recovery", before: state(2), recovery: true, terminal: false });
    const e = new LocalEngine(m), png = scene();
    for (let i = 0; i < 4; i++) { expect(e.decide(png, sha(png)).type).toBe("act"); e.verify(png, sha(png)); }
    expect(e.telemetry().recoveryAttempts).toBe(0);
  });
  it("retains short ordered movement chords in a bounded skill", () => {
    const demo = demonstration();
    demo.frames[1]!.atMs = 1000; demo.frames[1]!.eventCount = 4;
    demo.events = [
      { atMs: 0, action: { kind: "key-down", key: "KeyW" } },
      { atMs: 250, action: { kind: "key-down", key: "KeyD" } },
      { atMs: 600, action: { kind: "key-up", key: "KeyD" } },
      { atMs: 1000, action: { kind: "key-up", key: "KeyW" } }
    ];
    expect(frameSkill(demo, 0)?.actions).toEqual([
      { kind: "hold", keys: ["KeyW"], buttons: [], durationMs: 200 },
      { kind: "hold", keys: ["KeyD", "KeyW"], buttons: [], durationMs: 280 },
      { kind: "hold", keys: ["KeyW"], buttons: [], durationMs: 320 }
    ]);
  });
  it("explains rejected retrievals and observed progress numerically", () => {
    const { m } = memoryFixture(), engine = new LocalEngine(m);
    engine.decide(scene(2), sha(scene(2)));
    expect(engine.telemetry().candidates[0]?.rejection).toContain("Scene similarity");
    engine.decide(scene(), sha(scene())); engine.verify(scene(), sha(scene()));
    expect(engine.telemetry().assessment).toMatchObject({ changed: 0, result: "neutral" });
  });
  it("keeps available ordinary actions until the configured stuck budget when no recovery was taught", () => {
    const { m } = memoryFixture(), engine = new LocalEngine(m, { maxNoProgress: 6 });
    for (let i = 0; i < 4; i++) {
      expect(engine.decide(scene(), sha(scene())).type).toBe("act"); engine.verify(scene(), sha(scene()));
    }
    expect(engine.telemetry().recoveryAttempts).toBe(0); expect(engine.telemetry().candidates.length).toBeGreaterThan(0);
  });
  it("imports pointer evidence and clicks the current matched location instead of the demonstration coordinate", async () => {
    const images = [scene(0, 24), scene(1)], demo = demonstration(images), m = newMemory(behavior);
    demo.events = [{ atMs: 0, action: { kind: "move", point: { x: .25, y: .5 } } }, { atMs: 100, action: { kind: "button-down", button: "left" } }, { atMs: 150, action: { kind: "button-up", button: "left" } }]; demo.frames[1]!.eventCount = 3;
    await importDemonstration(m, demo, { behaviorId: behavior.id, recovery: false }, async id => images[id]!);
    const png = scene(0, 60), decision = new LocalEngine(m).decide(png, sha(png));
    expect(decision.type).toBe("act"); if (decision.type !== "act") throw new Error("No grounded action");
    const click = decision.actions.find(a => a.kind === "click"); expect(click?.kind).toBe("click"); if (click?.kind === "click") expect(click.point.x).toBeCloseTo(.625, 1);
  });
  it("imports held control relationships and multiple demonstrations idempotently", async () => {
    const images = [scene(), scene(1)], demo = demonstration(images), m = newMemory(behavior);
    const annotation = { behaviorId: behavior.id, demonstrationId: demo.id, recovery: false };
    expect(frameSkill(demo, 0)?.actions).toEqual([{ kind: "hold", keys: ["KeyW"], buttons: [], durationMs: 750 }]);
    expect((await importDemonstration(m, demo, annotation, async id => images[id]!)).added).toBe(1);
    expect((await importDemonstration(m, demo, annotation, async id => images[id]!)).added).toBe(0);
    const second = demonstration(images); await importDemonstration(m, second, { ...annotation, demonstrationId: second.id, recovery: true }, async id => images[id]!);
    expect(m.transitions).toHaveLength(2); expect(m.imports).toHaveLength(2); expect(m.transitions[1]?.recovery).toBe(true); expect(LocalMemorySchema.safeParse(m).success).toBe(true);
  });
  it("reports import coverage by reason and rejects an ambiguous annotation before replacing knowledge", async () => {
    const images = [scene(), scene(1)], demo = demonstration(images), m = newMemory(behavior);
    const result = await importDemonstration(m, demo, { behaviorId: behavior.id, recovery: false }, async id => images[id]!);
    expect(result).toMatchObject({ total: 1, added: 1, skipped: 0, merged: 0, skippedByReason: {} });
    const ambiguous = [scene(0, 24, true), scene(1)], other = demonstration(ambiguous);
    await expect(importDemonstration(m, other, { behaviorId: behavior.id, recovery: false, target: { frameId: 0, point: { x: .25, y: .5 }, size: .125 } }, async id => ambiguous[id]!)).rejects.toThrow(/uniquely/);
    expect(m.transitions).toHaveLength(1);
  });
  it("uses failed demonstrations as negative terminal experience", async () => {
    const images = [scene(), scene(1)], demo = demonstration(images), m = newMemory(behavior); demo.outcome = "failure";
    await importDemonstration(m, demo, { behaviorId: behavior.id, recovery: false }, async id => images[id]!);
    expect(m.transitions[0]).toMatchObject({ prior: "failure", terminal: false });
  });
  it("rejects damaged evidence and unsafe/ambiguous demonstrated controls", async () => {
    const demo = demonstration(), m = newMemory(behavior); demo.events[0]!.action = { kind: "key-down", key: "Alt" };
    expect(frameSkill(demo, 0)).toBeNull();
    const valid = demonstration(); await expect(importDemonstration(m, valid, { behaviorId: behavior.id, recovery: false }, async () => scene(2))).rejects.toThrow(/checksum/);
    expect(m.imports).toHaveLength(0);
  });
  it("increases/decreases action score with smoothed experience without one observation destroying a demonstration", () => {
    const { m, transition: t } = memoryFixture(); const original = actionScore(m, t, t.before).value;
    recordResult(m, t, t.before, t.before, "negative"); expect(actionScore(m, t, t.before).value).toBeLessThan(original); expect(actionScore(m, t, t.before).value).toBeGreaterThan(.5);
    for (let i = 0; i < 9; i++) recordResult(m, t, t.before, t.after, "positive");
    expect(actionScore(m, t, t.before).value).toBeGreaterThan(original); expect(m.runtime).toHaveLength(1);
  });
  it("selects a demonstrated action, observes its result and learns online", () => {
    const { m } = memoryFixture(), e = new LocalEngine(m), before = scene(), after = scene(1);
    expect(e.decide(before, sha(before)).type).toBe("act"); expect(e.validate(before, sha(before))).toBe(true);
    expect(e.verify(after, sha(after)).result).toBe("progress"); expect(m.totals.positive).toBe(1);
  });
  it("shares action outcomes across equivalent demonstrations and rejects a solely failed action", () => {
    const { m, transition } = memoryFixture(); const duplicate = { ...structuredClone(transition), id: transition.id + "copy" }; m.transitions.push(duplicate);
    for (let i = 0; i < 10; i++) recordResult(m, transition, transition.before, transition.after, "negative");
    expect(actionScore(m, duplicate, transition.before).value).toBeLessThan(.35);
    expect(new LocalEngine(m).decide(scene(), sha(scene())).type).toBe("pause");
  });
  it("does not treat input delivery or unrelated visual change as success", () => {
    const { m } = memoryFixture(), e = new LocalEngine(m), png = scene();
    e.decide(png, sha(png)); expect(e.verify(png, sha(png)).result).toBe("no-progress"); expect(m.totals.successes).toBe(0);
    e.decide(png, sha(png)); expect(e.verify(scene(2), sha(scene(2))).result).not.toBe("progress");
  });
  it("requires two distinct observations of discriminative success evidence", () => {
    const { m } = memoryFixture(), e = new LocalEngine(m, { finishOnSuccess: true }), png = scene(1);
    expect(e.decide(png, sha(png)).type).toBe("act"); expect(e.decide(png, sha(png)).type).toBe("complete"); expect(m.totals.successes).toBe(1);
  });
  it("pauses on unknown states and stale visual targets without random input", () => {
    const { m } = memoryFixture(), e = new LocalEngine(m);
    expect(e.decide(scene(2), sha(scene(2))).type).toBe("pause"); e.decide(scene(), sha(scene())); expect(e.validate(scene(2), sha(scene(2)))).toBe(false);
  });
  it("bounds repeated non-progress actions and uses only applicable learned recovery", () => {
    const { m, transition } = memoryFixture(); m.transitions.push({ ...structuredClone(transition), id: transition.id + "r", recovery: true, terminal: false, actions: [{ kind: "hold", keys: ["KeyS"], buttons: [], durationMs: 300 }] });
    const e = new LocalEngine(m), png = scene(); let recovery = false, paused = false;
    for (let i = 0; i < 12; i++) { const d = e.decide(png, sha(png)); if (d.type === "pause") { paused = true; break; } if (d.type === "act") recovery ||= d.actions.some(a => a.kind === "hold" && a.keys.includes("KeyS")); e.verify(png, sha(png)); }
    expect(recovery).toBe(true); expect(paused).toBe(true); expect(m.totals.experiences).toBeLessThan(12);
  });
  it("bounds runtime state memory, permits correction and supports forgetting without deleting evidence", () => {
    const { m, transition } = memoryFixture();
    for (let i = 0; i < LOCAL_LIMITS.runtime; i++) m.runtime.push({ transitionId: transition.id, before: state(2), after: state(2), positive: 0, negative: 0, neutral: 0, uncertain: 1, updatedAt: String(i) });
    recordResult(m, transition, transition.before, transition.after, "positive"); expect(m.runtime).toHaveLength(LOCAL_LIMITS.runtime); expect(m.totals.evicted).toBe(1);
    new LocalEngine(m).correct(transition.id, "wrong-state"); expect(transition.disabled).toBe(true);
    clearRuntime(m); expect(m.runtime).toHaveLength(0); expect(m.transitions).toHaveLength(1);
    forgetDemonstration(m, transition.demoId); expect(m.transitions).toHaveLength(0); expect(m.imports).toHaveLength(0);
  });
  it("rejects malformed settings and persisted unbounded actions", () => {
    expect(LocalRunOptionsSchema.safeParse({ minConfidence: .1 }).success).toBe(false);
    const { m, transition } = memoryFixture(); transition.actions = [{ kind: "key-down", key: "KeyW" }]; expect(LocalMemorySchema.safeParse(m).success).toBe(false);
  });
});
