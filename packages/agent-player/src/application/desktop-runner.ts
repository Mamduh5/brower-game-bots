import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { DesktopActionSchema, type DesktopAction, type DesktopObservation, type DesktopSession, type DesktopWindow } from "@game-bots/environment-sdk";
import { DesktopProfileSchema, type DesktopProfile } from "@game-bots/game-sdk";
import type { ArtifactRef } from "@game-bots/contracts";
import type { ArtifactStore } from "@game-bots/runtime-core";
import { MacroReplay, primitiveTimeline } from "../macro/replay.js";

export interface DesktopHistoryEntry {
  action: DesktopAction; before: string; after: string; screenChanged: boolean;
  verification: "progress" | "no-progress" | "unknown"; reason: string;
  actions?: DesktopAction[]; intent?: string;
}
export interface DesktopDecisionContext {
  goal: string; observation: DesktopObservation; history: readonly DesktopHistoryEntry[];
  skills: DesktopProfile["skills"]; actionsRemaining: number; elapsedMs: number;
}
const DecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("act"), actions: z.array(DesktopActionSchema).min(1).max(16), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("skill"), skillId: z.string(), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("complete"), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("pause"), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("stop"), reason: z.string().max(2000) }).strict()
]);
export type DesktopDecision = z.infer<typeof DecisionSchema>;
const VerificationSchema = z.object({ result: z.enum(["progress", "no-progress", "unknown"]), reason: z.string().max(2000) }).strict();
/** Provider/game integrations receive pixels and history, never a raw input handle. */
export interface DesktopPolicy {
  readonly boundedBatch?: boolean;
  readonly managesProgress?: boolean;
  readonly local?: boolean;
  close?(): Promise<void>;
  checkpoint?(): Promise<void>;
  validateObservation?(observation: DesktopObservation, signal: AbortSignal): Promise<boolean>;
  telemetry?(): object;
  configuration?(): object;
  reset?(): void;
  decide(context: DesktopDecisionContext, signal: AbortSignal): Promise<DesktopDecision>;
  verify(context: DesktopDecisionContext, before: DesktopObservation, action: DesktopAction, signal: AbortSignal): Promise<z.infer<typeof VerificationSchema>>;
}
export type DesktopRunStatus = "starting" | "running" | "paused" | "stopping" | "completed" | "stopped" | "failed";
export interface DesktopRunState {
  runId: string; status: DesktopRunStatus; profile: DesktopProfile; target: DesktopWindow;
  startedAt: string; endedAt: string | null; actionCount: number; latestAction: DesktopAction | null;
  latestScreenshot: ArtifactRef | null; reason: string; history: DesktopHistoryEntry[];
  logs: { at: string; message: string }[]; report: ArtifactRef | null;
  loopIndex: number; completedLoops: number; countdownEndsAt: string | null;
  intelligence?: object;
}

/** Bounded pixel-driven runner; browser Player/Tester contracts stay unchanged. */
export class DesktopRunner {
  readonly state: DesktopRunState;
  private readonly abort = new AbortController();
  private step = new AbortController();
  private task: Promise<void> | undefined;
  private started = 0;
  private unchanged = 0;
  private policyFailures = 0;
  private screenshotCount = 0;
  private screenshotBytes = 0;
  private readonly evidence: ArtifactRef[] = [];
  private readonly events: object[] = [];
  private controlTask: Promise<void> = Promise.resolve();
  private pauseStarted = 0;
  private pausedMs = 0;
  private lastEvidenceAt = 0;
  private lastEvidenceHash = "";
  private droppedEvents = 0;
  private macroSamples = 0;

  constructor(private readonly session: DesktopSession, private readonly artifacts: ArtifactStore, target: DesktopWindow, profile: DesktopProfile, private readonly policy?: DesktopPolicy) {
    const validated = DesktopProfileSchema.parse(profile);
    if (validated.mode !== "automation" && !policy) throw new Error("Learned mode requires an installed DesktopPolicy.");
    this.state = { runId: `desktop-${randomUUID()}`, status: "starting", profile: validated, target, startedAt: new Date().toISOString(), endedAt: null, actionCount: 0, latestAction: null, latestScreenshot: null, reason: "Start delay", history: [], logs: [], report: null, loopIndex: 1, completedLoops: 0, countdownEndsAt: null };
  }
  start(): Promise<void> {
    if (this.task) throw new Error("Run already started");
    this.task = this.run(); return this.task;
  }
  private log(message: string): void {
    const event = { at: new Date().toISOString(), message };
    this.events.push(event); this.state.logs.push(event); this.state.logs = this.state.logs.slice(-100);
    this.state.reason = message;
    this.boundEvents();
  }
  private boundEvents() { if (!this.policy?.local && !this.state.profile.macro) return; const limit = 500; if (this.events.length > limit) { this.droppedEvents += this.events.length - limit; this.events.splice(0, this.events.length - limit); } }
  private control(operation: () => Promise<void>): Promise<void> {
    const next = this.controlTask.then(operation); this.controlTask = next.catch(() => undefined); return next;
  }
  pause(reason = "Paused by user"): Promise<void> {
    return this.control(async () => {
      if (!["running", "starting"].includes(this.state.status)) return;
      this.state.status = "paused"; this.pauseStarted = performance.now(); this.step.abort(new Error(reason));
      this.policy?.reset?.();
      await this.session.pause(); this.log(reason);
      await this.policy?.checkpoint?.();
    });
  }
  resume(): Promise<void> {
    return this.control(async () => {
      if (this.state.status !== "paused") return;
      // Focus is only requested after an explicit user resume, never in recovery.
      await this.session.focus(); await delay(200, undefined, { signal: this.abort.signal });
      await this.session.observe(); await this.session.resume();
      this.pausedMs += performance.now() - this.pauseStarted;
      this.step = new AbortController(); this.state.status = "running"; this.log("Resumed; a fresh observation will precede input");
    });
  }
  async stop(): Promise<void> {
    if (["completed", "stopped", "failed"].includes(this.state.status)) { await this.task; return; }
    this.state.status = "stopping"; this.abort.abort(new Error("Stopped by user")); this.step.abort();
    await this.session.pause(); await this.task;
  }
  private context(observation: DesktopObservation): DesktopDecisionContext {
    return { goal: this.state.profile.goal, observation, history: this.state.history.slice(), skills: this.state.profile.skills, actionsRemaining: this.state.profile.maxActions - this.state.actionCount, elapsedMs: performance.now() - this.started };
  }
  private async callPolicy<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    const timeoutMs = this.state.profile.policyTimeoutMs ?? 15000;
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(new Error(`Policy timed out after ${timeoutMs / 1000} seconds`)), timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    let onAbort: () => void = () => undefined;
    try {
      combined.throwIfAborted();
      return await Promise.race([fn(combined), new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason); combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      })]);
    } finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); if (this.policy?.telemetry) this.state.intelligence = this.policy.telemetry(); }
  }
  private async capture(): Promise<DesktopObservation> {
    const observation = this.state.profile.macro && this.session.observeMacro ? await this.session.observeMacro() : await this.session.observe();
    if (this.policy?.local && observation.png.length > 16 * 1024 * 1024) throw new Error("Local screenshot exceeds the 16 MiB evidence limit");
    if (this.policy?.local && this.state.latestScreenshot && (Date.now() - this.lastEvidenceAt < 5000 || observation.sha256 === this.lastEvidenceHash)) return observation;
    // Immutable evidence has both a count and byte budget; subsequent captures update a live image.
    const retain = this.screenshotCount < (this.policy?.local ? 16 : 100) && this.screenshotBytes + observation.png.length <= (this.policy?.local ? 16 : 64) * 1024 * 1024;
    const relativePath = retain ? `screenshots/${String(this.screenshotCount++).padStart(4, "0")}.png` : "screenshots/latest.png";
    if (retain) this.screenshotBytes += observation.png.length;
    const ref = await this.artifacts.put({ runId: this.state.runId, kind: "screenshot", relativePath, contentType: "image/png" }, observation.png);
    if (!relativePath.endsWith("latest.png")) this.evidence.push(ref);
    this.state.latestScreenshot = ref;
    this.lastEvidenceAt = Date.now(); this.lastEvidenceHash = observation.sha256;
    this.events.push({ type: "observation", at: observation.capturedAt, sha256: observation.sha256, geometry: observation.geometry, path: ref.relativePath });
    this.boundEvents();
    return observation;
  }
  private async interval(ms: number, signal: AbortSignal): Promise<void> {
    for (let remaining = ms; remaining > 0; remaining -= 100) {
      await delay(Math.min(100, remaining), undefined, { signal });
      const health = await this.session.health();
      if (!health.armed) throw new Error(health.reason ?? "Native input disarmed");
    }
  }
  private async readyForSequence(): Promise<void> {
    while (true) {
      this.abort.signal.throwIfAborted();
      const health = await this.session.health();
      if (health.reason && /F8|deadline|identity|lost, hidden|heartbeat|Held input|release failed|Watchdog|modifier/i.test(health.reason)) throw new Error(health.reason);
      if (!health.armed && this.state.status === "running") await this.pause(health.reason ?? "Input disarmed");
      if (this.state.status !== "paused") return;
      await delay(100, undefined, { signal: this.abort.signal });
    }
  }
  /** Recorded edges share the same controller; no screenshots between tightly timed input edges. */
  private async runConfiguredSequence(): Promise<void> {
    const p = this.state.profile;
    const timeline = p.playback === "recorded" ? primitiveTimeline(p) : null;
    if (timeline && this.session.executeTimeline) { await this.runNativeSequence(timeline); return; }
    if (p.macro?.visualCorrection) throw new Error("Visual Macro replay requires an unedited primitive timeline and the current native helper");
    const totalLoops = p.loop?.mode === "once" ? 1 : p.loop?.mode === "count" ? p.loop.count : Infinity;
    const heldKeys = new Set<string>(); const heldButtons = new Set<"left" | "right" | "middle">();
    let point: { x: number; y: number } | undefined;
    const remember = (action: DesktopAction): void => {
      if (action.kind === "key-down") heldKeys.add(action.key);
      if (action.kind === "key-up") heldKeys.delete(action.key);
      if (action.kind === "button-down") heldButtons.add(action.button);
      if (action.kind === "button-up") heldButtons.delete(action.button);
      if (action.kind === "release-all") { heldKeys.clear(); heldButtons.clear(); }
      if (action.kind === "move" || action.kind === "click") point = action.point;
      if (action.kind === "drag") point = action.to;
    };
    const execute = async (action: DesktopAction, geometry: string, signal: AbortSignal): Promise<void> => {
      signal.throwIfAborted();
      this.state.latestAction = action; this.state.actionCount++;
      this.events.push({ type: "action", at: new Date().toISOString(), action, number: this.state.actionCount, loop: this.state.loopIndex });
      remember(action); await this.session.execute(action, geometry, signal);
    };
    for (let loop = 1; loop <= totalLoops && this.state.actionCount < p.maxActions; loop++) {
      this.state.loopIndex = loop;
      await this.readyForSequence(); let observation = await this.capture(); let due = performance.now();
      let restore = false; let accountedPause = this.pausedMs; let finishedSteps = 0;
      for (const step of p.actions) {
        due += p.playback === "recorded" ? step.delayBeforeMs ?? 0 : 0;
        let dispatched = false;
        while (!dispatched && this.state.actionCount < p.maxActions) {
          try {
            await this.readyForSequence();
            if (this.pausedMs !== accountedPause) { due += this.pausedMs - accountedPause; accountedPause = this.pausedMs; restore = true; }
            const signal = AbortSignal.any([this.abort.signal, this.step.signal]);
            if (restore) {
              observation = await this.capture();
              const restored: DesktopAction[] = [
                ...(point && heldButtons.size ? [{ kind: "move" as const, point }] : []),
                ...[...heldKeys].map(key => ({ kind: "key-down" as const, key })),
                ...[...heldButtons].map(button => ({ kind: "button-down" as const, button }))
              ];
              for (const action of restored) { if (this.state.actionCount >= p.maxActions) break; await execute(action, observation.geometry, signal); }
              restore = false;
            }
            if (this.state.actionCount >= p.maxActions) break;
            await this.interval(Math.max(0, due - performance.now()), signal);
            signal.throwIfAborted();
            // Do not burst through overdue input after slow dispatch/pauses.
            if (performance.now() - due > 250) { this.log("Playback fell behind; timing resynchronized without a catch-up burst"); due = performance.now(); }
            dispatched = true;
            if (step.enabled === false) continue;
            const { delayBeforeMs: _timing, enabled: _enabled, ...raw } = step;
            const action = DesktopActionSchema.parse(raw);
            await execute(action, observation.geometry, signal);
            // Manually inserted blocking actions extend the recorded timeline.
            if (p.playback === "recorded" && "durationMs" in action) due += action.durationMs;
            if (p.playback === "interval") {
              await this.interval(p.intervalMs, signal);
              const after = await this.capture();
              this.unchanged = observation.sha256 === after.sha256 ? this.unchanged + 1 : 0;
              this.state.history.push({ action, before: observation.sha256, after: after.sha256, screenChanged: observation.sha256 !== after.sha256, verification: "unknown", reason: "Configured playback" });
              this.state.history = this.state.history.slice(-20); observation = after;
              if (p.maxUnchangedObservations > 0 && this.unchanged >= p.maxUnchangedObservations) { this.unchanged = 0; await this.pause("Screen unchanged limit reached; inspect the target before resuming"); }
            }
          } catch (error) {
            if (this.abort.signal.aborted) throw error;
            const health = await this.session.health();
            if (this.state.status !== "paused" && (!health.reason || !/focus|geometry|Paused/i.test(health.reason))) throw error;
            await this.pause(health.reason ?? "Paused");
            await this.readyForSequence(); restore = true;
            // A partially dispatched action is never automatically repeated.
          }
        }
        if (dispatched) finishedSteps++;
        if (this.state.actionCount >= p.maxActions) break;
      }
      await this.session.releaseAll(); heldKeys.clear(); heldButtons.clear();
      await this.readyForSequence(); await this.capture();
      if (finishedSteps === p.actions.length) this.state.completedLoops++;
      if (loop >= totalLoops || this.state.actionCount >= p.maxActions) break;
      let loopDelayEnd = performance.now() + (p.loop?.delayMs ?? 0);
      let loopPause = this.pausedMs;
      while (performance.now() < loopDelayEnd) {
        await this.readyForSequence();
        loopDelayEnd += this.pausedMs - loopPause; loopPause = this.pausedMs;
        await delay(Math.min(100, Math.max(0, loopDelayEnd - performance.now())), undefined, { signal: this.abort.signal });
      }
    }
    this.state.status = "completed";
    this.log(this.state.actionCount >= p.maxActions ? "Action limit reached" : "Configured loops completed");
  }
  private async runNativeSequence(timeline: NonNullable<ReturnType<typeof primitiveTimeline>>): Promise<void> {
    const p = this.state.profile;
    const loops = p.loop?.mode === "count" ? p.loop.count : p.loop?.mode === "until-stopped" ? Infinity : 1;
    for (let loop = 1; loop <= loops && this.state.actionCount < p.maxActions; loop++) {
      this.state.loopIndex = loop;
      await this.readyForSequence();
      const replay = new MacroReplay(this.session, p, {
        ready: () => this.readyForSequence(), signal: () => AbortSignal.any([this.abort.signal, this.step.signal]), paused: () => this.state.status === "paused",
        capture: () => this.capture(), remaining: () => p.maxActions - this.state.actionCount,
        attempted: (action, count) => { this.state.actionCount += count; this.state.latestAction = action; },
        telemetry: value => {
          const { samples, ...summary } = value as { samples?: unknown[] };
          this.state.intelligence = summary;
          const retained = samples?.slice(0, Math.max(0, 2048 - this.macroSamples)); this.macroSamples += retained?.length ?? 0;
          this.events.push(retained?.length ? { ...summary, samples: retained } : summary); this.boundEvents();
        }
      });
      const before = this.state.actionCount;
      try { await replay.run(timeline); } finally { await this.session.releaseAll(); }
      if (this.state.actionCount - before >= timeline.length) this.state.completedLoops++;
      if (loop >= loops || this.state.actionCount >= p.maxActions) break;
      let due = performance.now() + (p.loop?.delayMs ?? 0), paused = this.pausedMs;
      while (performance.now() < due) {
        await this.readyForSequence(); due += this.pausedMs - paused; paused = this.pausedMs;
        await delay(Math.min(100, Math.max(0, due - performance.now())), undefined, { signal: this.abort.signal });
      }
    }
    this.state.status = "completed"; this.log(this.state.actionCount >= p.maxActions ? "Action limit reached" : "Configured loops completed");
  }
  private async run(): Promise<void> {
    this.started = performance.now();
    const p = this.state.profile;
    const deadline = setTimeout(() => this.abort.abort(new Error("Run duration limit reached")), p.maxDurationMs);
    let index = 0;
    try {
      await this.session.bind(this.state.target, p.maxDurationMs, p.maxHoldMs);
      await this.artifacts.put({ runId: this.state.runId, kind: "json", relativePath: "reports/configuration.json", contentType: "application/json" }, Buffer.from(JSON.stringify({ target: this.state.target, profile: p }, null, 2)));
      if (this.policy?.configuration) await this.artifacts.put({ runId: this.state.runId, kind: "json", relativePath: "reports/learned-memory.json", contentType: "application/json" }, Buffer.from(JSON.stringify(this.policy.configuration(), null, 2)));
      this.state.countdownEndsAt = new Date(Date.now() + p.startDelayMs).toISOString();
      for (let remaining = p.startDelayMs; remaining > 0; remaining -= 100) {
        await delay(Math.min(100, remaining), undefined, { signal: this.abort.signal });
        if (/F8/.test((await this.session.health()).reason ?? "")) throw new Error("F8 emergency stop during countdown");
      }
      this.state.countdownEndsAt = null;
      if (this.state.status === "starting") {
        await this.session.focus(); await delay(200, undefined, { signal: this.abort.signal });
        await this.session.resume(); this.state.status = "running";
      }
      this.log("Target bound; F8 is the emergency stop");
      if (!this.policy && (p.loop || p.playback === "recorded" || p.actions.some(a => a.enabled !== undefined || a.delayBeforeMs !== undefined))) {
        await this.runConfiguredSequence(); return;
      }
      while (this.state.actionCount < p.maxActions) {
        this.abort.signal.throwIfAborted();
        const health = await this.session.health();
        if (health.reason && /F8|deadline|identity|lost, hidden|heartbeat|Held input|release failed|Watchdog|modifier/i.test(health.reason)) throw new Error(health.reason);
        if (!health.armed && this.state.status === "running") await this.pause(health.reason ?? "Input disarmed");
        if (this.state.status === "paused") { await delay(100, undefined, { signal: this.abort.signal }); continue; }
        const signal = AbortSignal.any([this.abort.signal, this.step.signal]);
        try {
          let observation = await this.capture();
          let actions: DesktopAction[];
          if (this.policy) {
            // Model latency must never extend a held input from a previous decision.
            await this.session.releaseAll();
            const decision = DecisionSchema.parse(await this.callPolicy(s => this.policy!.decide(this.context(observation), s), signal));
            signal.throwIfAborted();
            this.log(decision.reason);
            // Recheck the target even for completion: a lost window cannot yield success.
            const fresh = await this.capture();
            signal.throwIfAborted();
            if (fresh.geometry !== observation.geometry) throw new Error("Geometry changed during decision");
            const currentHealth = await this.session.health();
            if (!currentHealth.armed) throw new Error(currentHealth.reason ?? "Native input disarmed");
            if (decision.type === "pause") { await this.pause(decision.reason); continue; }
            if (this.policy.validateObservation && !await this.callPolicy(s => this.policy!.validateObservation!(fresh, s), signal)) { await this.pause("Visual target changed before dispatch; inspect or teach the current state"); continue; }
            signal.throwIfAborted();
            if (decision.type === "complete" || decision.type === "stop") { this.state.status = decision.type === "complete" ? "completed" : "stopped"; break; }
            if (decision.type === "skill") {
              const skill = p.skills.find(s => s.id === decision.skillId);
              if (!skill) throw new Error(`Unknown skill ${decision.skillId}`);
              actions = skill.actions;
            } else actions = decision.actions;
            // Fresh screenshot guards geometry changes while the policy was deciding.
            observation = fresh;
          } else actions = [p.actions[index % p.actions.length]!];
          const batchBefore = observation;
          if (this.policy?.boundedBatch) {
            if (actions.length > 8 || actions.reduce((n, a) => n + ("durationMs" in a ? a.durationMs : 0), 0) > 2000) throw new Error("Policy action batch exceeds safety bounds");
            if (actions.length > p.maxActions - this.state.actionCount) { this.state.status = "stopped"; this.log("Action budget cannot fit the next bounded action; goal not verified"); break; }
          }
          for (const action of actions) {
            signal.throwIfAborted();
            if (this.state.actionCount >= p.maxActions) break;
            this.state.latestAction = action;
            // Count attempts before dispatch, including interrupted/failed actions.
            this.state.actionCount++;
            index++;
            this.events.push({ type: "action", at: new Date().toISOString(), action, number: this.state.actionCount });
            await this.session.execute(action, observation.geometry, signal);
            if (this.policy?.boundedBatch) continue;
            await this.interval(p.intervalMs, signal);
            const after = await this.capture();
            const changed = observation.sha256 !== after.sha256;
            this.unchanged = changed ? 0 : this.unchanged + 1;
            const entry: DesktopHistoryEntry = { action, before: observation.sha256, after: after.sha256, screenChanged: changed, verification: "unknown", reason: "Pixel change is not proof of goal progress" };
            // Verification happens after the bounded action batch releases held input below.
            this.state.history.push(entry); this.state.history = this.state.history.slice(-20);
            this.events.push({ type: "verification", ...entry });
            if (p.maxUnchangedObservations > 0 && this.unchanged >= p.maxUnchangedObservations) {
              await this.pause("Screen unchanged limit reached; inspect the target before resuming"); this.unchanged = 0; break;
            }
            observation = after;
          }
          if (this.policy && this.state.status === "running") {
            await this.session.releaseAll();
            if (this.policy.boundedBatch) {
              await this.interval(p.intervalMs, signal);
              observation = await this.capture();
              const action = actions.at(-1)!;
              this.state.history.push({ action, actions, intent: this.state.reason, before: batchBefore.sha256, after: observation.sha256, screenChanged: batchBefore.sha256 !== observation.sha256, verification: "unknown", reason: "Awaiting live visual assessment" });
              this.state.history = this.state.history.slice(-20);
            }
            const entry = this.state.history.at(-1);
            if (entry) {
              const verification = VerificationSchema.parse(await this.callPolicy(s => this.policy!.verify(this.context(observation), batchBefore, entry.action, s), signal));
              entry.verification = verification.result; entry.reason = verification.reason;
              this.events.push({ type: "policy-verification", ...verification });
              if (verification.result === "no-progress" && !this.policy.managesProgress) {
                this.policyFailures++;
                if (this.policyFailures >= 3) { await this.pause("Three decisions without verified progress; inspect or change strategy"); this.policyFailures = 0; }
              } else if (verification.result === "progress") this.policyFailures = 0;
            }
          }
          this.boundEvents();
        } catch (error) {
          if (this.abort.signal.aborted) throw error;
          if (["paused"].includes(this.state.status)) continue;
          const health = await this.session.health();
          if (!health.armed && health.reason && /focus|geometry|Paused/i.test(health.reason)) { await this.pause(health.reason); continue; }
          // Input failures are never retried: they may already have had an effect.
          throw error;
        }
      }
      if (this.state.status === "running") { this.state.status = this.policy ? "stopped" : "completed"; this.log(this.policy ? "Action limit reached; goal not verified" : "Action limit reached"); }
    } catch (error) {
      const reason = this.abort.signal.aborted ? String(this.abort.signal.reason?.message ?? "Stopped") : error instanceof Error ? error.message : String(error);
      this.state.status = this.abort.signal.aborted || /F8/.test(reason) ? "stopped" : "failed"; this.log(reason);
    } finally {
      clearTimeout(deadline);
      this.state.countdownEndsAt = null;
      try { await this.session.close(); } catch (error) { this.state.status = "failed"; this.log(`Cleanup failed: ${String(error)}`); }
      try { await this.policy?.close?.(); if (this.policy?.telemetry) this.state.intelligence = this.policy.telemetry(); } catch (error) { this.state.status = "failed"; this.log(`Learning checkpoint failed: ${String(error)}`); }
      this.state.endedAt = new Date().toISOString();
      try {
        this.boundEvents();
        this.state.report = await this.artifacts.put({ runId: this.state.runId, kind: "json", relativePath: "reports/desktop-summary.json", contentType: "application/json" }, Buffer.from(JSON.stringify({ ...this.state, evidence: this.evidence, events: this.events, droppedEvents: this.droppedEvents }, null, 2)));
      } catch (error) { this.state.status = "failed"; this.log(`Report write failed: ${String(error)}`); }
    }
  }
}
