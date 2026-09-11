import { createHash } from "node:crypto";
import type { DesktopAction } from "@game-bots/environment-sdk";
import { DemonstrationSchema, LocalTrainSchema, type Demonstration, type LocalTrainRequest } from "@game-bots/game-sdk";
import { decodeGrid, features, matchTarget, patchAt, similarity, visualChange, type ImageGrid, type TargetPatch } from "./vision.js";
import { forgetDemonstration, LOCAL_LIMITS, pruneMemory, type LocalMemory, type Transition } from "./memory.js";

/** Extract short simultaneous holds and camera adjustments, never a replay timeline. */
export function frameSkill(demo: Demonstration, index: number): { actions: DesktopAction[]; point: { x: number; y: number } | null } | null {
  const before = demo.frames[index]!, after = demo.frames[index + 1]!;
  if (after.atMs <= before.atMs || after.atMs - before.atMs > 1500 || before.geometry !== after.geometry) return null;
  const events = demo.events.slice(before.eventCount, after.eventCount);
  if (events.some(e => e.atMs < before.atMs - 100 || e.atMs > after.atMs + 100)) return null;
  const keys = new Set(before.heldKeys); const durations = new Map<string, { keys: string[]; duration: number }>();
  let time = before.atMs, point: { x: number; y: number } | null = null, click: "left" | "right" | "middle" | null = null;
  let dx = 0, dy = 0, ticks = 0, axis: "vertical" | "horizontal" = "vertical";
  const buttons = new Set(before.heldButtons);
  const hold = (end: number) => { if (keys.size && end > time) { const list = [...keys].sort(), id = list.join("+"); const previous = durations.get(id); durations.set(id, { keys: list, duration: (previous?.duration ?? 0) + end - time }); } time = end; };
  // Recover cursor position before this frame, used only to crop a target, never to dispatch a click.
  for (const e of demo.events.slice(0, before.eventCount)) if (e.action.kind === "move" || e.action.kind === "click") point = e.action.point;
  let unsupported = false;
  for (const e of events) {
    hold(Math.max(time, Math.min(after.atMs, e.atMs))); const a = e.action;
    if (a.kind === "key-down") keys.add(a.key);
    if (a.kind === "key-up") keys.delete(a.key);
    if (a.kind === "move") { if (click) unsupported = true; point = a.point; }
    if (a.kind === "click") { click = a.button; point = a.point; }
    if (a.kind === "button-down") { buttons.add(a.button); if (demo.cameraMode === "pointer") click = a.button; }
    if (a.kind === "relative-move") { dx += a.dx; dy += a.dy; }
    if (a.kind === "scroll") { ticks += a.ticks; axis = a.axis; }
    if (a.kind === "drag" || a.kind === "hold") unsupported = true;
    if (a.kind === "release-all") keys.clear();
  }
  hold(after.atMs);
  if (unsupported || durations.size > 1 || [...durations.values()].some(h => h.keys.length > 4 || h.keys.some(k => /^(F\d+|Alt|Control)$/.test(k)))) return null;
  const actions: DesktopAction[] = [];
  if (demo.cameraMode === "relative" && (dx || dy)) {
    actions.push({ kind: "move", point: { x: .5, y: .5 } });
    for (const button of buttons) actions.push({ kind: "button-down", button });
    actions.push({ kind: "relative-move", dx: Math.max(-300, Math.min(300, dx)), dy: Math.max(-300, Math.min(300, dy)) }, { kind: "release-all" });
  }
  for (const h of durations.values()) actions.push({ kind: "hold", keys: h.keys, buttons: [], durationMs: Math.max(50, Math.min(800, Math.round(h.duration))) });
  if (click && demo.cameraMode === "pointer") {
    if (!point || durations.size || ticks) return null;
    actions.push({ kind: "click", point: { x: .5, y: .5 }, button: click, durationMs: 50 });
  }
  if (ticks && !click) { actions.push({ kind: "move", point: { x: .5, y: .5 } }, { kind: "scroll", ticks: Math.max(-3, Math.min(3, ticks)), axis }); }
  if (demo.cameraMode === "relative" && !dx && !dy && buttons.size && !durations.size) {
    actions.push({ kind: "move", point: { x: .5, y: .5 } }, { kind: "hold", keys: [], buttons: [...buttons], durationMs: Math.min(800, Math.round(after.atMs - before.atMs)) });
  }
  return actions.length && actions.length <= 8 ? { actions, point: click ? point : null } : null;
}

export async function importDemonstration(memory: LocalMemory, raw: Demonstration, rawAnnotation: LocalTrainRequest, image: (frameId: number) => Promise<Uint8Array>): Promise<{ added: number; skipped: number }> {
  const demo = DemonstrationSchema.parse(raw), annotation = LocalTrainSchema.parse(rawAnnotation);
  if (demo.behaviorId !== memory.behaviorId || demo.target.processName !== memory.processName || demo.cameraMode !== memory.cameraMode) throw new Error("Demonstration identity does not match local behavior");
  if (demo.frames.length < 2) throw new Error("Local learning requires at least two screenshot frames");
  if (demo.frames.some((f, i) => f.eventCount > demo.events.length || (i > 0 && (f.atMs < demo.frames[i - 1]!.atMs || f.eventCount < demo.frames[i - 1]!.eventCount)))) throw new Error("Invalid demonstration timeline");
  if (annotation.successFrame !== undefined && !demo.frames.some(f => f.id === annotation.successFrame)) throw new Error("Success frame is missing");
  if (annotation.target && !demo.frames.some(f => f.id === annotation.target!.frameId)) throw new Error("Target frame is missing");
  if (annotation.region && JSON.stringify(annotation.region) !== JSON.stringify(memory.region)) {
    if (memory.imports.length) throw new Error("Reset local learning before changing the important region");
    memory.region = annotation.region;
  }
  const outcome = annotation.outcome ?? demo.outcome;
  const digest = createHash("sha256").update(JSON.stringify({ demo, annotation })).digest("hex");
  if (memory.imports.find(i => i.id === demo.id)?.hash === digest) return { added: 0, skipped: 0 };
  // Decode evidence serially with a two-frame cache. Raw history is not retained.
  const cache = new Map<number, ImageGrid>();
  const grid = async (id: number) => { let value = cache.get(id); if (!value) { const bytes = await image(id); const expected = demo.frames.find(f => f.id === id)!.sha256; if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("Demonstration screenshot checksum mismatch"); value = decodeGrid(bytes); if (cache.size >= 2) cache.delete(cache.keys().next().value!); cache.set(id, value); } return value; };
  let annotationPatch: TargetPatch | null = null;
  if (annotation.target) { const t = annotation.target; annotationPatch = patchAt(await grid(t.frameId), t.point.x, t.point.y, t.size, t.size); if (!annotationPatch) throw new Error("Marked target is featureless or too close to an edge; mark a smaller textured region"); }
  // Commit replacement only after all evidence has been successfully processed.
  const pending: Transition[] = [], patches = new Map<string, LocalMemory["targets"][number]>(); let skipped = 0;
  for (let i = 0; i < demo.frames.length - 1; i++) {
    const skill = frameSkill(demo, i); if (!skill) { skipped++; continue; }
    const first = demo.frames[i]!, last = demo.frames[i + 1]!;
    const a = await grid(first.id), b = await grid(last.id), before = features(a, memory.region), after = features(b, memory.region);
    const patch = skill.point ? patchAt(a, skill.point.x, skill.point.y) : annotationPatch;
    if (skill.point && !patch) { skipped++; continue; }
    let targetId: string | null = null, targetBefore: Transition["targetBefore"] = null, targetAfter: Transition["targetAfter"] = null;
    if (patch) {
      const match = matchTarget(a, patch); if (!match) { skipped++; continue; }
      targetId = createHash("sha256").update(JSON.stringify(patch)).digest("hex");
      patches.set(targetId, { id: targetId, ...patch }); targetBefore = { x: match.x, y: match.y };
      const afterMatch = matchTarget(b, patch); if (afterMatch) targetAfter = { x: afterMatch.x, y: afterMatch.y };
    }
    const endpoint = annotation.successFrame ?? demo.frames.at(-1)!.id;
    const terminal = outcome === "success" && last.id === endpoint && visualChange(before, after) > .025 && similarity(before, after) < .93;
    const prior = outcome === "failure" && i !== demo.frames.length - 2 ? "uncertain" : outcome;
    pending.push({ id: `${demo.id}:${first.id}`, demoId: demo.id, frameId: first.id, before, after, actions: skill.actions, targetId, targetBefore, targetAfter,
      prior, terminal, recovery: annotation.recovery, samples: 1, disabled: false });
  }
  if (!pending.length) throw new Error("No usable bounded visual transitions. Record a short, slower demonstration with clear screenshots; ambiguous targets and mixed controls are skipped.");
  if (outcome === "failure") pending.at(-1)!.prior = "failure";
  if (outcome === "success") {
    const endpoint = demo.frames.find(f => f.id === (annotation.successFrame ?? demo.frames.at(-1)!.id))!;
    const terminal = [...pending].reverse().find(t => t.frameId < endpoint.id);
    if (terminal) {
      const index = demo.frames.findIndex(f => f.id === terminal.frameId), immediate = demo.frames[index + 1]!;
      // A settling frame can label completion only if no additional input intervened.
      if (endpoint.eventCount === immediate.eventCount && endpoint.atMs - immediate.atMs <= 2000) {
        const endState = features(await grid(endpoint.id), memory.region);
        if (visualChange(terminal.before, endState) > .025 && similarity(terminal.before, endState) < .93) { terminal.after = endState; terminal.terminal = true; }
      }
    }
  }
  forgetDemonstration(memory, demo.id);
  memory.imports.push({ id: demo.id, hash: digest, annotation });
  let added = 0;
  for (const t of pending) {
    const duplicate = memory.transitions.find(p => p.demoId === t.demoId && p.recovery === t.recovery && p.prior === t.prior && !p.terminal && !t.terminal && p.targetId === t.targetId && JSON.stringify(p.actions) === JSON.stringify(t.actions) && similarity(p.before, t.before) > .99 && similarity(p.after, t.after) > .99);
    if (duplicate) { duplicate.samples++; continue; }
    if (t.targetId && !memory.targets.some(p => p.id === t.targetId)) {
      if (memory.targets.length >= LOCAL_LIMITS.targets) { skipped++; continue; }
      memory.targets.push(patches.get(t.targetId)!);
    }
    if (memory.transitions.length >= LOCAL_LIMITS.transitions) {
      // Retain terminal/recovery exemplars preferentially, evict the oldest redundant ordinary state.
      const index = memory.transitions.findIndex(p => !p.terminal && !p.recovery);
      if (index < 0) { skipped++; continue; }
      memory.transitions.splice(index, 1); memory.totals.evicted++;
    }
    memory.transitions.push(t); added++;
  }
  memory.totals.skipped += skipped; pruneMemory(memory);
  return { added, skipped };
}
