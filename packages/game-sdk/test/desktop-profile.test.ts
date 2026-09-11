import { describe, it, expect } from "vitest";
import { DesktopProfileSchema } from "../src/desktop-profile.js";
import { DesktopActionSchema } from "@game-bots/environment-sdk";
const base = { version: 1, name: "test", actions: [{ kind: "wait", durationMs: 100 }] };
describe("desktop configuration boundaries", () => {
  it("permits explicit 12-hour local budgets while keeping native input limits and other mode limits", () => {
    expect(DesktopProfileSchema.safeParse({ ...base, mode: "local", maxDurationMs: 43200000, maxActions: 250000 }).success).toBe(true);
    expect(DesktopProfileSchema.safeParse({ ...base, mode: "local", maxDurationMs: 86400001 }).success).toBe(false);
    expect(DesktopProfileSchema.safeParse({ ...base, mode: "feedback", maxDurationMs: 43200000 }).success).toBe(false);
  });
  it.each([{ intervalMs: 0 }, { maxActions: 0 }, { maxActions: 10001 }, { maxDurationMs: 3600001 }, { startDelayMs: 60000, maxDurationMs: 1000 }, { actions: [] }, { mode: "magic-ai" }])("rejects invalid limits %j", patch => { expect(DesktopProfileSchema.safeParse({ ...base, ...patch }).success).toBe(false); });
  it.each([{ kind: "key-down", key: "F8" }, { kind: "key-down", key: "Meta" }, { kind: "hold", keys: ["KeyW"], durationMs: 6000 }, { kind: "click", button: "left", point: { x: -1, y: .5 } }, { kind: "relative-move", dx: 1001, dy: 0 }, { kind: "shell", command: "anything" }])("rejects unsupported or unbounded input %j", action => { expect(DesktopActionSchema.safeParse(action).success).toBe(false); });
  it("supports chords, held buttons and normalized target points", () => {
    expect(DesktopActionSchema.parse({ kind: "hold", keys: ["Control", "KeyA"], buttons: ["left"], durationMs: 100 })).toMatchObject({ durationMs: 100 });
    expect(DesktopActionSchema.parse({ kind: "move", point: { x: 0, y: 1 } }).kind).toBe("move");
  });
  it("rejects duplicate behavior identifiers", () => { const skill = { id: "move", description: "move", actions: base.actions }; expect(DesktopProfileSchema.safeParse({ ...base, skills: [skill, skill] }).success).toBe(false); });
});
