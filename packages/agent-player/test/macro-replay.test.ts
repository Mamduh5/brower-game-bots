import { describe, it, expect, vi } from "vitest";
import { PNG } from "pngjs";
import { DesktopProfileSchema, MacroEvidenceSchema, recordingToProfile, type MacroFeature, type MacroFrame } from "@game-bots/game-sdk";
import type { DesktopSession, TimelineEvent } from "@game-bots/environment-sdk";
import { alignmentClass, macroFeatures, macroMotion, strengthenMacroFrames } from "../src/macro/vision.js";
import { correctionFor, MacroReplay, primitiveTimeline, type MacroReplayHooks } from "../src/macro/replay.js";

function features(): MacroFeature[] {
  return Array.from({ length: 30 }, (_, i) => ({ x: 15 + i % 6 * 24, y: 28 + Math.floor(i / 6) * 16, persistence: 3,
    descriptor: Array.from({ length: 49 }, (_, n) => Math.sin((i + 1) * (n + 1) * 1.71)) }));
}
function transformed(dx = 0, scale = 1): MacroFeature[] { return features().map(f => ({ ...f, x: (f.x - 80) * scale + 80 + dx, y: (f.y - 60) * scale + 60 })); }
const frame = (f: MacroFeature[], atMs = 0): MacroFrame => ({ features: f, atMs, eventCount: 0, neutral: true, image: "", sha256: "0".repeat(64) });
function image(): Buffer {
  const png = new PNG({ width: 160, height: 120 }); let seed = 42;
  for (let i = 0; i < png.data.length; i += 4) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; png.data[i] = png.data[i + 1] = png.data[i + 2] = seed >>> 24; png.data[i + 3] = 255; }
  return PNG.sync.write(png);
}
function shiftedImage(dx: number, removePatch = false): Buffer {
  const source = PNG.sync.read(image()), target = new PNG({ width: 160, height: 120 });
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) {
    const at = (y * 160 + x) * 4, from = (y * 160 + x - dx) * 4;
    if (x - dx >= 0 && x - dx < 160 && !(removePatch && x > 105 && y > 65)) source.data.copy(target.data, at, from, from + 4);
    target.data[at + 3] = 255;
  }
  return PNG.sync.write(target);
}
describe("Macro trajectory evidence", () => {
  it("retains fractional ordering, raw deltas, simultaneous holds and high-resolution wheel units", () => {
    const source: TimelineEvent[] = [
      { atMs: .125, action: { kind: "key-down", key: "KeyW" } }, { atMs: 1.25, action: { kind: "button-down", button: "right" } },
      { atMs: 1.25, action: { kind: "relative-move", dx: 6, dy: -1 } }, { atMs: 2.875, action: { kind: "key-down", key: "KeyD" } },
      { atMs: 3.125, action: { kind: "relative-move", dx: 9, dy: 0 } }, { atMs: 5.25, action: { kind: "scroll", ticks: 1 / 120, axis: "vertical" } },
      { atMs: 9.625, action: { kind: "release-all" } }
    ];
    const p = recordingToProfile(source); p.macro = { version: 1, visualCorrection: false, source: source.map(e => e.action.kind === "relative-move" ? { ...e, rawMouse: { dx: e.action.dx, dy: e.action.dy, x: .5, y: .5, relative: true } } : e), frames: [], width: 640, height: 480 };
    const restored = DesktopProfileSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(primitiveTimeline(restored)).toEqual(source); expect(restored.macro!.source[2]!.rawMouse!.dx).toBe(6);
  });
  it("fits scene translation despite removed and independently moving objects", () => {
    const b = transformed(5).slice(5); b[4] = { ...b[4]!, x: 100, y: 70 };
    const m = macroMotion(features(), b);
    expect(m.dx).toBeCloseTo(5); expect(m.inliers).toBe(24); expect(alignmentClass(m)).toBe("small");
  });
  it("measures human versus bot scale displacement separately", () => {
    const human = macroMotion(features(), transformed(0, 1.08));
    const bot = macroMotion(features(), transformed(0, 1.04));
    expect(human.scale).toBeCloseTo(1.08); expect(bot.scale).toBeCloseTo(1.04);
  });
  it("rejects wrong scenes, large mismatch, ambiguous repeated patches and sparse matches", () => {
    expect(alignmentClass(macroMotion(features(), transformed(25)))).toBe("wrong");
    expect(alignmentClass(macroMotion(features(), transformed().slice(0, 6)))).toBe("wrong");
    expect(macroMotion(features(), transformed().map(f => ({ ...f, descriptor: features()[0]!.descriptor }))).confidence).toBe(0);
  });
  it("temporal consensus strengthens persistent geometry but not independent motion", () => {
    const frames = [0, 2, 4].map((x, i) => frame(transformed(x).map(f => ({ ...f, persistence: 1 })), i * 400));
    frames[1]!.features[0]!.x += 30; frames[2]!.features[0]!.x -= 25;
    strengthenMacroFrames(frames);
    expect(frames[0]!.features[4]!.persistence).toBe(3); expect(frames[1]!.features[0]!.persistence).toBe(1);
  });
  it("extracts bounded nonsemantic features and rejects oversized input before decoding", () => {
    const f = macroFeatures(image()); expect(f.length).toBeGreaterThan(12); expect(f.length).toBeLessThanOrEqual(96);
    const malicious = image(); malicious.writeUInt32BE(200000, 16); expect(() => macroFeatures(malicious)).toThrow(/Invalid/);
  });
  it("bounds camera correction and recognizes movement overshoot", () => {
    const camera = { type: "camera" as const, dx: -20, dy: 0, scale: 1, inputX: 100, inputY: 0, duration: 0, key: "", button: "right" as const };
    const correction = correctionFor(macroMotion(features(), transformed(4)), [camera], false);
    expect(correction).toEqual([{ kind: "button-down", button: "right" }, { kind: "relative-move", dx: 20, dy: 0 }, { kind: "release-all" }]);
    expect(correctionFor(macroMotion(features(), transformed(10)), [camera], false)).toBeNull();
    const movement = { ...camera, type: "movement" as const, dx: 0, scale: 1.2, inputX: 0, duration: 400, key: "KeyW", button: null };
    expect(correctionFor(macroMotion(features(), transformed(0, .96)), [movement], true)?.[0]).toMatchObject({ kind: "hold", keys: ["KeyW"] });
    expect(correctionFor(macroMotion(features(), transformed(0, 1.04)), [movement], true)).toBeNull();
  });
  it("matches decoded image patches after translation and removal of a transient region", () => {
    const a = macroFeatures(image()).map(f => ({ ...f, persistence: 3 })), b = macroFeatures(shiftedImage(4, true));
    const fit = macroMotion(a, b); expect(fit.dx).toBeCloseTo(4); expect(alignmentClass(fit)).toBe("small");
  });
  it("rejects unsupported evidence versions, unsorted times and excess storage", () => {
    const p = { version: 1, visualCorrection: true, source: [{ atMs: 0, action: { kind: "release-all" } }], frames: [], width: 640, height: 480 };
    expect(MacroEvidenceSchema.safeParse({ ...p, version: 2 }).success).toBe(false);
    expect(MacroEvidenceSchema.safeParse({ ...p, frames: [frame([], 2), frame([], 1)] }).success).toBe(false);
    expect(MacroEvidenceSchema.safeParse({ ...p, frames: Array.from({ length: 161 }, () => frame([])) }).success).toBe(false);
  });
});

describe("Native Macro orchestration", () => {
  function setup(visual = false) {
    const png = image(), f = macroFeatures(png).map(f => ({ ...f, persistence: 3 }));
    const source: TimelineEvent[] = [{ atMs: 0, action: { kind: "key-down", key: "KeyW" } }, { atMs: 20.5, action: { kind: "relative-move", dx: 6, dy: 0 } }, { atMs: 40.25, action: { kind: "release-all" } }];
    const profile = recordingToProfile(source);
    profile.macro = { version: 1, visualCorrection: visual, source, frames: [frame(f)], width: 160, height: 120 };
    const observation = { png, sha256: "0".repeat(64), geometry: "g", capturedAt: "", window: { handle: "1", pid: 1, processStartedAt: "1", processName: "fixture", title: "fixture", dpi: 96, bounds: { x: 0, y: 0, width: 160, height: 120 } } };
    const executeTimeline = vi.fn(async (events: readonly TimelineEvent[]) => ({ completed: events.length, positionMs: events.at(-1)!.atMs, maxLatenessMs: 7, meanLatenessMs: 2, error: null, samples: [] }));
    const session = { executeTimeline, execute: vi.fn(), releaseAll: vi.fn() } as unknown as DesktopSession;
    const hooks: MacroReplayHooks = { ready: vi.fn(), signal: () => new AbortController().signal, paused: () => false, capture: vi.fn(async () => observation), remaining: () => 100, attempted: vi.fn(), telemetry: vi.fn() };
    return { source, profile, hooks, session, executeTimeline };
  }
  it("dispatches a single master timeline without per-event observation or sleeps", async () => {
    const t = setup(); await new MacroReplay(t.session, t.profile, t.hooks).run(t.source);
    expect(t.executeTimeline).toHaveBeenCalledTimes(1); expect(t.executeTimeline.mock.calls[0]![0]).toEqual(t.source);
    expect(t.hooks.capture).toHaveBeenCalledTimes(1); expect(t.session.releaseAll).toHaveBeenCalled();
  });
  it("aborts a wrong starting view before movement is dispatched", async () => {
    const t = setup(true); t.profile.macro!.frames[0]!.features = [];
    await expect(new MacroReplay(t.session, t.profile, t.hooks).run(t.source)).rejects.toThrow(/start state mismatch/);
    expect(t.executeTimeline).not.toHaveBeenCalled();
  });
  it("refuses stale visual evidence after action edits", async () => {
    const t = setup(true); const edited = structuredClone(t.source); edited[1]!.atMs += 1;
    await expect(new MacroReplay(t.session, t.profile, t.hooks).run(edited)).rejects.toThrow(/edited/);
    expect(t.executeTimeline).not.toHaveBeenCalled();
  });
  it("does not retry an uncertain partially dispatched native batch", async () => {
    const t = setup(); t.executeTimeline.mockResolvedValueOnce({ completed: 1, positionMs: 1, maxLatenessMs: 101, meanLatenessMs: 101, error: "Timeline late", samples: [] } as never);
    await expect(new MacroReplay(t.session, t.profile, t.hooks).run(t.source)).rejects.toThrow(/Timeline late/);
    expect(t.executeTimeline).toHaveBeenCalledTimes(1); expect(t.hooks.attempted).toHaveBeenCalledWith(t.source[0]!.action, 1);
  });
  it("stops after a correction fails to improve the image and releases its button", async () => {
    const t = setup(true);
    const a = macroFeatures(image()).map(f => ({ ...f, persistence: 3 })), b = macroFeatures(shiftedImage(-20)).map(f => ({ ...f, persistence: 3 }));
    const source: TimelineEvent[] = [{ atMs: 100, action: { kind: "button-down", button: "right" } }, { atMs: 200, action: { kind: "relative-move", dx: 100, dy: 0 } }, { atMs: 300, action: { kind: "button-up", button: "right" } }, { atMs: 600, action: { kind: "release-all" } }];
    t.profile = recordingToProfile(source);
    t.profile.macro = { version: 1, visualCorrection: true, source, width: 160, height: 120, frames: [frame(a), { ...frame(b, 400), eventCount: 3 }] };
    const base = await t.hooks.capture(); t.hooks.capture = vi.fn(async () => ({ ...base, png: shiftedImage(4) }));
    await expect(new MacroReplay(t.session, t.profile, t.hooks).run(source)).rejects.toThrow(/did not improve/);
    expect(t.session.releaseAll).toHaveBeenCalled(); expect(t.executeTimeline).not.toHaveBeenCalled();
    expect(vi.mocked(t.session.execute).mock.calls.filter(([action]) => action.kind === "relative-move")).toHaveLength(1);
  });
});
