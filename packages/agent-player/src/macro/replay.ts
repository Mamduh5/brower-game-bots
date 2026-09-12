import type { DesktopAction, DesktopObservation, DesktopSession, TimelineEvent } from "@game-bots/environment-sdk";
import type { DesktopProfile, MacroEvidence, MacroFrame } from "@game-bots/game-sdk";
import { alignmentClass, macroFeatures, macroMotion, type Motion } from "./vision.js";

const primitives = new Set(["move", "relative-move", "key-down", "key-up", "button-down", "button-up", "scroll", "release-all"]);
export function primitiveTimeline(profile: DesktopProfile): TimelineEvent[] | null {
  let atMs = 0; const result: TimelineEvent[] = [];
  for (const step of profile.actions) {
    atMs += step.delayBeforeMs ?? 0;
    if (step.enabled === false) continue;
    const { delayBeforeMs: _delay, enabled: _enabled, ...action } = step;
    if (!primitives.has(action.kind) || atMs > 120000) return null;
    result.push({ atMs, action });
  }
  return result;
}
interface ResponseModel { type: "camera" | "movement"; dx: number; dy: number; scale: number; inputX: number; inputY: number; duration: number; key: string; button: "left" | "right" | "middle" | null }
/** Only isolated demonstrated input establishes a response. Mixed movement is replayed but never guessed apart. */
export function demonstratedResponses(evidence: MacroEvidence): ResponseModel[] {
  const models: ResponseModel[] = [];
  for (let i = 1; i < evidence.frames.length; i++) {
    const a = evidence.frames[i - 1]!, b = evidence.frames[i]!;
    const motion = macroMotion(a.features, b.features);
    if (motion.confidence < .7 || motion.inliers < 12 || b.atMs - a.atMs < 60) continue;
    const keys = new Set<string>(), buttons = new Set<"left" | "right" | "middle">();
    for (const e of evidence.source.slice(0, a.eventCount)) remember(e.action, keys, buttons);
    const usedKeys = new Set(keys), usedButtons = new Set(buttons);
    let x = 0, y = 0, pointer = false;
    for (const e of evidence.source.slice(a.eventCount, b.eventCount)) {
      const action = e.action;
      if (action.kind === "relative-move") { x += action.dx; y += action.dy; }
      else if (action.kind === "move" || action.kind === "scroll") pointer = true;
      if (action.kind === "key-down") usedKeys.add(action.key);
      if (action.kind === "button-down") usedButtons.add(action.button);
    }
    if (pointer) continue;
    if (!usedKeys.size && usedButtons.size <= 1 && Math.hypot(x, y) >= 8 && Math.hypot(motion.dx, motion.dy) >= 3 && Math.abs(motion.scale - 1) < .03)
      models.push({ type: "camera", ...motion, inputX: x, inputY: y, duration: 0, key: "", button: [...usedButtons][0] ?? null });
    if (usedKeys.size === 1 && !usedButtons.size && !x && !y && Math.abs(motion.scale - 1) >= .025 && Math.hypot(motion.dx, motion.dy) < 4)
      models.push({ type: "movement", ...motion, inputX: 0, inputY: 0, duration: b.atMs - a.atMs, key: [...usedKeys][0]!, button: null });
  }
  return models;
}
function remember(a: DesktopAction, keys: Set<string>, buttons: Set<"left" | "right" | "middle">): void {
  if (a.kind === "key-down") keys.add(a.key);
  if (a.kind === "key-up") keys.delete(a.key);
  if (a.kind === "button-down") buttons.add(a.button);
  if (a.kind === "button-up") buttons.delete(a.button);
  if (a.kind === "release-all") { keys.clear(); buttons.clear(); }
}
export function correctionFor(alignment: Motion, models: readonly ResponseModel[], allowMovement: boolean): DesktopAction[] | null {
  if (alignmentClass(alignment) !== "small") return null;
  if (Math.abs(alignment.scale - 1) <= .025) {
    for (const m of models.filter(m => m.type === "camera").reverse()) {
      const length = m.dx * m.dx + m.dy * m.dy;
      const ratio = -(alignment.dx * m.dx + alignment.dy * m.dy) / length;
      const residual = Math.hypot(alignment.dx + ratio * m.dx, alignment.dy + ratio * m.dy);
      if (residual > 2 || Math.abs(ratio) > .3) continue;
      const dx = Math.round(m.inputX * ratio), dy = Math.round(m.inputY * ratio);
      if (!dx && !dy || Math.hypot(dx, dy) > 40) continue;
      return [...(m.button ? [{ kind: "button-down" as const, button: m.button }] : []), { kind: "relative-move", dx, dy }, { kind: "release-all" }];
    }
  }
  if (allowMovement && Math.hypot(alignment.dx, alignment.dy) <= 3) {
    for (const m of models.filter(m => m.type === "movement").reverse()) {
      const ratio = -Math.log(alignment.scale) / Math.log(m.scale);
      // Positive only: overshoot is recognized, never reversed by inventing a navigation action.
      const durationMs = Math.round(m.duration * ratio);
      if (ratio <= 0 || ratio > .25 || durationMs < 5 || durationMs > 120) continue;
      return [{ kind: "hold", keys: [m.key], buttons: [], durationMs }, { kind: "release-all" }];
    }
  }
  return null;
}
export interface MacroReplayHooks {
  ready(): Promise<void>; signal(): AbortSignal; paused(): boolean;
  capture(): Promise<DesktopObservation>; remaining(): number;
  attempted(action: DesktopAction, count: number): void; telemetry(value: object): void;
}
export class MacroReplay {
  private readonly keys = new Set<string>(); private readonly buttons = new Set<"left" | "right" | "middle">();
  private previousBot: ReturnType<typeof macroFeatures> | undefined;
  private previousHuman: MacroFrame | undefined;
  private readonly models: ResponseModel[];
  private corrections = 0;
  private pointer: { x: number; y: number } | undefined;
  private relativePointer = false;
  constructor(private readonly session: DesktopSession, private readonly profile: DesktopProfile, private readonly hooks: MacroReplayHooks) {
    this.models = profile.macro ? demonstratedResponses(profile.macro) : [];
  }
  private async verify(frame: MacroFrame, start: boolean): Promise<void> {
    let observation = await this.hooks.capture();
    let features = macroFeatures(observation.png);
    const human = this.previousHuman ? macroMotion(this.previousHuman.features, frame.features) : null;
    const bot = this.previousBot ? macroMotion(this.previousBot, features, false) : null;
    let alignment = macroMotion(frame.features, features);
    const errorSize = (m: Motion) => Math.hypot(m.dx, m.dy) + Math.abs(Math.log(m.scale)) * 100;
    let previous = errorSize(alignment);
    for (let retry = 0; ; retry++) {
      this.hooks.signal().throwIfAborted();
      const state = alignmentClass(alignment);
      this.hooks.telemetry({ type: "macro-checkpoint", timelineMs: frame.atMs, alignment, classification: state, humanDisplacement: human, botDisplacement: bot, retry, corrections: this.corrections, calibrationApplied: false });
      if (state === "good") break;
      if (state === "wrong" || retry >= 2 || this.corrections >= 8) throw new Error(`Macro ${start ? "start state" : "checkpoint"} mismatch: ${state}; correction limits or uncertain scene evidence`);
      // Movement correction additionally requires comparable starts and measured under-travel.
      const motionAgrees = !!human && !!bot && human.confidence >= .65 && bot.confidence >= .65 && Math.sign(Math.log(human.scale)) === Math.sign(Math.log(bot.scale)) && Math.abs(Math.log(bot.scale)) < Math.abs(Math.log(human.scale));
      const actions = correctionFor(alignment, this.models, !start && motionAgrees);
      if (!actions || actions.length > this.hooks.remaining()) throw new Error("Macro drift cannot be corrected from demonstrated evidence within input bounds");
      this.hooks.telemetry({ type: "macro-correction", checkpointMs: frame.atMs, actions, retry });
      try {
        for (const action of actions) { this.hooks.signal().throwIfAborted(); this.hooks.attempted(action, 1); await this.session.execute(action, observation.geometry, this.hooks.signal()); }
      } finally { await this.session.releaseAll(); }
      this.corrections++;
      await this.session.execute({ kind: "wait", durationMs: 80 }, observation.geometry, this.hooks.signal());
      observation = await this.hooks.capture(); features = macroFeatures(observation.png);
      const next = macroMotion(frame.features, features);
      // A worsening or sign-crossing correction is never reversed again; prevents oscillation.
      if (alignmentClass(next) !== "good" && (errorSize(next) >= previous * .85 || next.dx * alignment.dx + next.dy * alignment.dy < -1)) throw new Error("Macro correction did not improve alignment; stopped without oscillation");
      alignment = next; previous = errorSize(next);
    }
    this.previousBot = features; this.previousHuman = frame;
  }
  async run(events: TimelineEvent[]): Promise<void> {
    const evidence = this.profile.macro;
    const visual = !!evidence?.visualCorrection;
    const initial = await this.hooks.capture();
    let geometry = initial.geometry;
    if (visual) {
      const source = evidence!.source;
      if (events.length !== source.length || events.some((e, i) => Math.abs(e.atMs - source[i]!.atMs) > .001 || JSON.stringify(e.action) !== JSON.stringify(source[i]!.action))) throw new Error("Macro actions were edited; disable visual correction or record fresh evidence");
      const first = evidence!.frames[0];
      if (!first || first.atMs > 40 || first.eventCount !== 0 || !first.neutral) throw new Error("Macro starting visual evidence is missing; record again or select exact input replay");
      if (Math.abs(evidence!.width / evidence!.height - initial.window.bounds.width / initial.window.bounds.height) > .01) throw new Error("Macro recorded aspect ratio changed");
      await this.verify(first, true);
    }
    // Only neutral checkpoints may interrupt the master timeline. Active-input samples still train stable features/response evidence.
    const checkpoints = visual ? evidence!.frames.filter((f, i) => i > 0 && f.neutral && f.eventCount > 0 && f.atMs <= events.at(-1)!.atMs &&
      (!events[f.eventCount] || events[f.eventCount]!.atMs > f.atMs)) : [];
    if (visual) {
      let lastInput = -1; events.forEach((e, i) => { if (e.action.kind !== "release-all") lastInput = i; });
      if (!checkpoints.some(f => f.eventCount > lastInput)) throw new Error("Macro has no released-input visual endpoint; record again with a brief quiet finish");
    }
    let cursor = 0, origin = 0;
    for (const checkpoint of [...checkpoints, null]) {
      const end = checkpoint?.eventCount ?? events.length;
      if (end < cursor) continue;
      // Recompute held state from actual source edges; persisted neutral metadata is not trusted.
      if (checkpoint) {
        const k = new Set<string>(), b = new Set<"left" | "right" | "middle">();
        for (const e of events.slice(0, end)) remember(e.action, k, b);
        if (k.size || b.size) continue;
      }
      while (cursor < end) {
        await this.hooks.ready(); this.hooks.signal().throwIfAborted();
        const limit = Math.min(end, cursor + this.hooks.remaining());
        if (limit <= cursor) return;
        const chunk = events.slice(cursor, limit).map(e => ({ action: e.action, atMs: Math.max(0, e.atMs - origin) }));
        const base = cursor;
        const report = await this.session.executeTimeline!(chunk, geometry, this.hooks.signal(), value => { const { samples: _samples, ...summary } = value; this.hooks.telemetry({ type: "macro-timing", timelineMs: origin + value.positionMs, ...summary }); });
        const completed = Math.min(chunk.length, report.completed);
        for (let i = 0; i < completed; i++) {
          const action = chunk[i]!.action; remember(action, this.keys, this.buttons);
          if (action.kind === "move") { this.pointer = action.point; this.relativePointer = false; }
          if (action.kind === "relative-move") this.relativePointer = true;
        }
        if (completed) this.hooks.attempted(chunk[completed - 1]!.action, completed);
        cursor = base + completed;
        this.hooks.telemetry({ type: "macro-segment", sourceOffset: base, originMs: origin, ...report });
        if (report.error || this.hooks.signal().aborted) {
          if (!this.hooks.paused() && !/focus|geometry|Paused/i.test(report.error ?? "")) throw new Error(report.error ?? "Macro interrupted");
          origin += report.positionMs;
          await this.hooks.ready(); geometry = (await this.hooks.capture()).geometry;
          if (visual) {
            const nearest = [...evidence!.frames].sort((a, b) => Math.abs(a.atMs - origin) - Math.abs(b.atMs - origin))[0];
            if (!nearest || Math.abs(nearest.atMs - origin) > 120) throw new Error("Macro interruption has no nearby visual evidence; restart from the demonstrated state");
            await this.verify(nearest, true);
          }
          const restore: DesktopAction[] = [...(this.pointer && this.buttons.size && !this.relativePointer ? [{ kind: "move" as const, point: this.pointer }] : []), ...[...this.keys].map(key => ({ kind: "key-down" as const, key })), ...[...this.buttons].map(button => ({ kind: "button-down" as const, button }))];
          for (const action of restore) { if (!this.hooks.remaining()) return; this.hooks.attempted(action, 1); await this.session.execute(action, geometry, this.hooks.signal()); }
        } else if (completed !== chunk.length) throw new Error("Native Macro timeline returned an incomplete prefix");
      }
      if (checkpoint && cursor === end) {
        // Wait out the demonstrated quiet tail before observing (no input is held).
        const tail = Math.max(0, checkpoint.atMs - Math.max(events[end - 1]?.atMs ?? 0, origin));
        for (let remaining = tail; remaining > 0; remaining -= 5000) await this.session.execute({ kind: "wait", durationMs: Math.min(5000, Math.ceil(remaining)) }, geometry, this.hooks.signal());
        await this.verify(checkpoint, false); origin = checkpoint.atMs;
      }
    }
    await this.session.releaseAll();
    if (visual && !checkpoints.length) throw new Error("Macro has no safe visual endpoint; replay completed inputs but outcome is unverified");
  }
}
