import { describe, it, expect } from "vitest";
import { recordingToProfile } from "../src/recording.js";
import { DesktopProfileSchema } from "../src/desktop-profile.js";
import { DesktopHotkeysSchema } from "@game-bots/environment-sdk";

describe("recording conversion and additive profile format", () => {
  it("preserves overlapping W, Space and mouse holds with ordered relative timing", () => {
    const profile = recordingToProfile([
      { atMs: 0, action: { kind: "key-down", key: "KeyW" } },
      { atMs: 800, action: { kind: "key-down", key: "Space" } },
      { atMs: 850, action: { kind: "button-down", button: "left" } },
      { atMs: 950, action: { kind: "key-up", key: "Space" } },
      { atMs: 1000, action: { kind: "move", point: { x: .2, y: .7 } } },
      { atMs: 1100, action: { kind: "button-up", button: "left" } },
      { atMs: 1800, action: { kind: "key-up", key: "KeyW" } }
    ]);
    expect(profile.actions.map(a => a.delayBeforeMs)).toEqual([0,800,50,100,50,100,700,0]);
    expect(profile.actions.map(a => a.kind)).toEqual(["key-down","key-down","button-down","key-up","move","button-up","key-up","release-all"]);
    expect(profile).toMatchObject({ playback: "recorded", loop: { mode: "once" }, maxHoldMs: 60000 });
    expect(DesktopProfileSchema.parse(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
  });
  it("does not add another release if recording already has a cleanup boundary", () => {
    const p = recordingToProfile([{ atMs: 0, action: { kind: "key-down", key: "KeyW" } }, { atMs: 20, action: { kind: "release-all" } }]);
    expect(p.actions).toHaveLength(2);
  });
  it("rejects empty and unordered recordings", () => {
    expect(() => recordingToProfile([])).toThrow(/empty/);
    expect(() => recordingToProfile([{ atMs: 10, action: { kind: "move", point: { x: 0, y: 0 } } }, { atMs: 0, action: { kind: "release-all" } }])).toThrow(/ordered/);
  });
  it("keeps legacy profiles valid and does not silently change their loop behavior", () => {
    const p = DesktopProfileSchema.parse({ version: 1, name: "old", actions: [{ kind: "click", point: { x: .5, y: .5 }, button: "left" }] });
    expect(p.loop).toBeUndefined(); expect(p.playback).toBe("interval"); expect(p.maxHoldMs).toBe(5500);
  });
  it("round-trips disabled steps but rejects an entirely disabled sequence", () => {
    const base = { version: 1, name: "editable", actions: [{ kind: "key-down", key: "KeyW", enabled: false, delayBeforeMs: 15 }, { kind: "release-all", delayBeforeMs: 80 }] };
    expect(DesktopProfileSchema.parse(base).actions[0]).toMatchObject({ enabled: false, delayBeforeMs: 15 });
    expect(DesktopProfileSchema.safeParse({ ...base, actions: base.actions.map(a => ({ ...a, enabled: false })) }).success).toBe(false);
  });
  it.each([{ mode: "count", count: 0 }, { mode: "count", count: 10001 }, { mode: "until-stopped", delayMs: -1 }])("rejects invalid loops %j", loop => {
    expect(DesktopProfileSchema.safeParse({ version: 1, name: "bad", loop, actions: [{ kind: "wait", durationMs: 10 }] }).success).toBe(false);
  });
  it.each([{ record: "F6", bot: "F6", stopRecording: "F9" }, { record: "F8" }, { bot: "F12" }, { record: "KeyA" }])("rejects conflicting or reserved shortcuts %j", keys => {
    expect(DesktopHotkeysSchema.safeParse(keys).success).toBe(false);
  });
});
