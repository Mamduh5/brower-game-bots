import { RecordedEventSchema, type RecordedEvent } from "@game-bots/environment-sdk";
import { DesktopProfileSchema, type DesktopProfile, type DesktopSequenceAction } from "./desktop-profile.js";

/** Preserve fractional receipt times and every edge. Source packets remain available after editing. */
export function recordingToProfile(raw: readonly RecordedEvent[], name = "My recording"): DesktopProfile {
  if (!raw.length) throw new Error("The recording is empty. Record an action in the selected target first.");
  if (raw.length > 10000) throw new Error("Recording event limit exceeded");
  let previous = 0;
  const actions: DesktopSequenceAction[] = raw.map(event => {
    const item = RecordedEventSchema.parse(event);
    if (item.atMs < previous) throw new Error("Recording timestamps must be ordered");
    const action = { ...item.action, delayBeforeMs: item.atMs - previous, enabled: true };
    previous = item.atMs;
    return action;
  });
  if (!actions.some(a => !["release-all", "wait"].includes(a.kind))) throw new Error("The recording contains no input actions");
  if (actions.at(-1)?.kind !== "release-all") actions.push({ kind: "release-all", delayBeforeMs: 0, enabled: true });
  return DesktopProfileSchema.parse({ version: 1, name, playback: "recorded", mode: "automation", startDelayMs: 3000,
    maxActions: Math.min(10000, Math.max(100, actions.length * 10)), maxDurationMs: Math.max(60000, previous + 15000),
    maxHoldMs: 60000, loop: { mode: "once", count: 1, delayMs: 0 }, actions,
    macro: { version: 1, visualCorrection: false, source: raw, frames: [], width: 1, height: 1 } });
}
