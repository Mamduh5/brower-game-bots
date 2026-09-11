import { LocalRunOptionsSchema, type LocalRunOptions } from "@game-bots/game-sdk";
import type { DesktopAction } from "@game-bots/environment-sdk";
import type { DesktopDecision } from "../application/desktop-runner.js";
import { features, decodeGrid, similarity, matchTarget, visualChange, type ImageGrid, type Match } from "./vision.js";
import { LOCAL_LIMITS, type LocalMemory, type Transition } from "./memory.js";

export type LocalResult = "positive" | "negative" | "neutral" | "uncertain";
export function actionScore(memory: LocalMemory, t: Transition, state: number[]) {
  let positive = t.prior === "success" ? 2 : 0, negative = t.prior === "failure" ? 2 : 0, neutral = 0, samples = 0;
  const signature = JSON.stringify(t.actions);
  const equivalent = new Set(memory.transitions.filter(other => JSON.stringify(other.actions) === signature).map(other => other.id));
  for (const r of memory.runtime) if (equivalent.has(r.transitionId)) {
    const s = similarity(state, r.before); if (s < .85) continue;
    const n = r.positive + r.negative + r.neutral + r.uncertain, weight = s * Math.min(1, 30 / Math.max(1, n));
    positive += r.positive * weight; negative += r.negative * weight; neutral += r.neutral * weight; samples += n;
  }
  // Smoothing protects demonstrations from one noisy result; neutral repeated failures carry a small cost.
  return { value: (positive + 1) / (positive + negative + neutral * .35 + 2), samples };
}
export function recordResult(memory: LocalMemory, t: Transition, before: number[], after: number[], result: LocalResult) {
  let row = memory.runtime.find(r => r.transitionId === t.id && similarity(before, r.before) >= .98);
  if (!row) {
    if (memory.runtime.length >= LOCAL_LIMITS.runtime) { memory.runtime.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)); memory.runtime.shift(); memory.totals.evicted++; }
    row = { transitionId: t.id, before, after, positive: 0, negative: 0, neutral: 0, uncertain: 0, updatedAt: new Date().toISOString() }; memory.runtime.push(row);
  }
  row[result]++; row.after = after; row.updatedAt = new Date().toISOString();
  // Bounded effective history can adapt if conditions change, without erasing demonstration priors.
  if (row.positive + row.negative + row.neutral + row.uncertain > 200) for (const key of ["positive", "negative", "neutral", "uncertain"] as const) row[key] *= .5;
  memory.totals.experiences++; memory.totals[result]++;
}
export class LocalEngine {
  readonly options: LocalRunOptions;
  private cached: { hash: string; grid: ImageGrid; state: number[] } | undefined;
  private pending: { transition: Transition; state: number[]; target: Match | null } | undefined;
  private recent: { state: number[]; action: string }[] = [];
  private noProgress = 0; private recoveries = 0; private completionFrames = 0; private completionLatched = false;
  private confidence = 0; private status = "Ready"; private visionMs = 0; private decisionMs = 0; private retrieved = 0;
  private latestTransition: string | null = null;
  constructor(readonly memory: LocalMemory, options: Partial<LocalRunOptions> = {}) { this.options = LocalRunOptionsSchema.parse(options); }
  telemetry() { return { mode: "local", apiRequired: false, confidence: this.confidence, status: this.status, noProgress: this.noProgress, recoveryAttempts: this.recoveries,
    states: this.memory.transitions.length, demonstrations: this.memory.imports.length, targets: this.memory.targets.length, recoveryExamples: this.memory.transitions.filter(t => t.recovery).length,
    runtimeStates: this.memory.runtime.length, ...this.memory.totals, checkpointAt: this.memory.checkpointAt,
    visionMs: this.visionMs, decisionMs: this.decisionMs, statesRetrieved: this.retrieved, latestTransition: this.latestTransition,
    workerHeapBytes: process.memoryUsage().heapUsed, processRssBytes: process.memoryUsage().rss }; }
  reset() { this.pending = undefined; this.cached = undefined; this.completionFrames = 0; this.recent = []; this.noProgress = 0; this.recoveries = 0; }
  private observe(png: Uint8Array, hash: string) {
    if (this.cached?.hash === hash) return this.cached;
    const started = performance.now(), grid = decodeGrid(png), state = features(grid, this.memory.region);
    this.visionMs = performance.now() - started; this.memory.totals.observations++;
    return this.cached = { hash, grid, state };
  }
  private pause(reason: string): DesktopDecision { this.status = reason; this.pending = undefined; this.memory.totals.unknown++; return { type: "pause", reason }; }
  decide(png: Uint8Array, hash: string): DesktopDecision {
    const started = performance.now();
    try { return this.choose(png, hash); } finally { this.decisionMs = performance.now() - started; }
  }
  private choose(png: Uint8Array, hash: string): DesktopDecision {
    const { grid, state } = this.observe(png, hash); this.pending = undefined;
    const success = this.memory.transitions.filter(t => t.terminal && !t.disabled).some(t => similarity(state, t.after) > .96 && similarity(state, t.after) - similarity(state, t.before) > .07);
    this.completionFrames = success ? this.completionFrames + 1 : 0;
    if (!success) this.completionLatched = false;
    if (this.completionFrames >= 2 && !this.completionLatched) {
      this.memory.totals.successes++; this.completionLatched = true; this.noProgress = 0; this.recoveries = 0;
      if (this.options.finishOnSuccess) { this.status = "Learned success appearance confirmed twice"; return { type: "complete", reason: this.status }; }
    }
    if (success && (!this.completionLatched || this.completionFrames < 3)) return { type: "act", actions: [{ kind: "wait", durationMs: 350 }], reason: "Checking learned success appearance on another observation" };
    const recoveryNeeded = this.noProgress >= 3;
    const loop = this.recent.length >= 8 && this.recent.slice(-8).every(r => this.recent.slice(-2).some(s => similarity(s.state, r.state) > .98));
    if (this.noProgress >= this.options.maxNoProgress || (loop && this.noProgress >= 2)) { this.memory.totals.stuck++; return this.pause("Stuck or oscillating: take over and teach a recovery"); }
    if (recoveryNeeded && this.recoveries >= this.options.maxRecoveries) { this.memory.totals.stuck++; return this.pause("Local recovery budget exhausted; teach a correction"); }
    const matches = this.memory.transitions.filter(t => !t.disabled && (!recoveryNeeded || t.recovery)).map(t => ({ t, scene: similarity(state, t.before) }))
      .filter(c => c.scene >= .65).sort((a, b) => b.scene - a.scene).slice(0, 12);
    this.retrieved = matches.length;
    const targets = new Map<string, Match | null>();
    const candidates = matches.flatMap(({ t, scene }) => {
      let match: Match | null = null;
      if (t.targetId) {
        if (!targets.has(t.targetId)) { if (targets.size >= 4) return []; const target = this.memory.targets.find(p => p.id === t.targetId); targets.set(t.targetId, target ? matchTarget(grid, target) : null); }
        match = targets.get(t.targetId)!; if (!match) return [];
      }
      const statistics = actionScore(this.memory, t, state);
      if (statistics.value < .35) return [];
      let visual = scene;
      if (match) {
        const position = t.targetBefore ? Math.max(0, 1 - Math.hypot(match.x - t.targetBefore.x, match.y - t.targetBefore.y) * 2) : 1;
        // Pointer target location is grounded live; directional control needs a similar relative target position.
        visual = t.actions.some(a => a.kind === "click") ? .5 * scene + .5 * match.confidence : .45 * scene + .35 * position + .2 * match.confidence;
      }
      const confidence = visual * (.55 + .45 * statistics.value);
      const repeated = this.recent.slice(-4).filter(r => r.action === JSON.stringify(t.actions) && similarity(r.state, state) > .97).length;
      return [{ t, match, confidence, score: confidence - repeated * .07 - (t.prior === "failure" ? .18 : 0) }];
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0]; this.confidence = best?.confidence ?? 0;
    if (!best || best.confidence < this.options.minConfidence || best.score < .48) return this.pause("Unknown state, lost/ambiguous target, or low action confidence: add a demonstration");
    if (recoveryNeeded) this.recoveries++;
    const actions = structuredClone(best.t.actions);
    for (const action of actions) {
      if ("durationMs" in action) action.durationMs = Math.min(action.durationMs, this.options.maxActionMs, best.confidence < .78 ? 300 : 1000);
      if (action.kind === "click") { if (!best.match) return this.pause("Click target could not be grounded"); action.point = { x: best.match.x, y: best.match.y }; }
    }
    this.pending = { transition: best.t, state, target: best.match }; this.latestTransition = best.t.id;
    this.recent.push({ state, action: JSON.stringify(best.t.actions) }); this.recent = this.recent.slice(-12);
    this.status = `${recoveryNeeded ? "Recovery" : "Local action"}: ${Math.round(best.confidence * 100)}% match confidence`;
    return { type: "act", actions, reason: this.status };
  }
  /** Runner checks fresh target identity/geometry; this additionally rejects moving visual targets. */
  validate(png: Uint8Array, hash: string): boolean {
    if (!this.pending) { const previous = this.cached?.state; return !previous || similarity(previous, this.observe(png, hash).state) >= .96; }
    const current = this.observe(png, hash);
    if (similarity(current.state, this.pending.state) < .94) return false;
    if (this.pending.target && this.pending.transition.targetId) {
      const target = this.memory.targets.find(p => p.id === this.pending!.transition.targetId)!;
      const match = matchTarget(current.grid, target);
      if (!match || Math.hypot(match.x - this.pending.target.x, match.y - this.pending.target.y) > .035) return false;
    }
    // Actual pre-dispatch state is authoritative for online updates.
    this.pending.state = current.state; return true;
  }
  verify(png: Uint8Array, hash: string): { result: "progress" | "no-progress" | "unknown"; reason: string } {
    const { grid, state } = this.observe(png, hash), pending = this.pending; this.pending = undefined;
    if (!pending) return { result: "unknown", reason: "Observation only; no action experience added" };
    const t = pending.transition, changed = visualChange(pending.state, state);
    const expected = similarity(state, t.after), initial = similarity(pending.state, t.after);
    let result: LocalResult = "uncertain";
    if (changed < .006) result = "neutral";
    else if (expected >= .86 && expected - initial > .025 && t.prior === "success") result = "positive";
    else if (expected >= .93 && t.prior === "failure") result = "negative";
    else if (similarity(pending.state, state) < .5) result = "negative";
    if (t.targetId && t.targetBefore && t.targetAfter && pending.target) {
      const target = this.memory.targets.find(p => p.id === t.targetId)!, match = matchTarget(grid, target);
      if (match) {
        const dx = t.targetAfter.x - t.targetBefore.x, dy = t.targetAfter.y - t.targetBefore.y;
        const observedX = match.x - pending.target.x, observedY = match.y - pending.target.y;
        const norm = Math.hypot(dx, dy), actual = Math.hypot(observedX, observedY);
        if (norm > .025 && actual > .012) {
          const alignment = (dx * observedX + dy * observedY) / (norm * actual);
          if (alignment > .8 && t.prior === "success") result = "positive";
          else if (alignment < -.5) result = "negative";
        }
      }
    }
    recordResult(this.memory, t, pending.state, state, result);
    if (result === "positive") { this.noProgress = 0; this.recoveries = 0; } else this.noProgress++;
    return { result: result === "positive" ? "progress" : result === "uncertain" ? "unknown" : "no-progress",
      reason: result === "positive" ? "Observed change agrees with successful demonstration evidence" : result === "neutral" ? "Little observed movement; action confidence reduced" : result === "negative" ? "Failed or contrary transition; action confidence reduced" : "Visual change is inconclusive; no success credit" };
  }
  correct(transitionId: string, outcome: "success" | "failure" | "wrong-state") {
    const t = this.memory.transitions.find(t => t.id === transitionId); if (!t) throw new Error("Unknown local transition");
    if (outcome === "wrong-state") { t.disabled = true; return; }
    const row = [...this.memory.runtime].reverse().find(r => r.transitionId === transitionId);
    if (!row) throw new Error("No runtime result to correct");
    // Human labels have bounded extra weight; retain other observations and immutable demonstration priors.
    for (let i = 0; i < 4; i++) recordResult(this.memory, t, row.before, row.after, outcome === "success" ? "positive" : "negative");
  }
}
