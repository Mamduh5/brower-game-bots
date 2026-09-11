import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { DesktopActionSchema, type DesktopAction, type DesktopObservation, type DesktopSession, type DesktopWindow } from "@game-bots/environment-sdk";
import { DesktopProfileSchema, type DesktopProfile } from "@game-bots/game-sdk";
import type { ArtifactRef } from "@game-bots/contracts";
import type { ArtifactStore } from "@game-bots/runtime-core";

export interface DesktopHistoryEntry {
  action: DesktopAction; before: string; after: string; screenChanged: boolean;
  verification: "progress" | "no-progress" | "unknown"; reason: string;
}
export interface DesktopDecisionContext {
  goal: string; observation: DesktopObservation; history: readonly DesktopHistoryEntry[];
  skills: DesktopProfile["skills"]; actionsRemaining: number; elapsedMs: number;
}
const DecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("act"), actions: z.array(DesktopActionSchema).min(1).max(16), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("skill"), skillId: z.string(), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("complete"), reason: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("stop"), reason: z.string().max(2000) }).strict()
]);
export type DesktopDecision = z.infer<typeof DecisionSchema>;
const VerificationSchema = z.object({ result: z.enum(["progress", "no-progress", "unknown"]), reason: z.string().max(2000) }).strict();
/** Provider/game integrations receive pixels and history, never a raw input handle. */
export interface DesktopPolicy {
  decide(context: DesktopDecisionContext, signal: AbortSignal): Promise<DesktopDecision>;
  verify(context: DesktopDecisionContext, before: DesktopObservation, action: DesktopAction, signal: AbortSignal): Promise<z.infer<typeof VerificationSchema>>;
}
export type DesktopRunStatus = "starting" | "running" | "paused" | "stopping" | "completed" | "stopped" | "failed";
export interface DesktopRunState {
  runId: string; status: DesktopRunStatus; profile: DesktopProfile; target: DesktopWindow;
  startedAt: string; endedAt: string | null; actionCount: number; latestAction: DesktopAction | null;
  latestScreenshot: ArtifactRef | null; reason: string; history: DesktopHistoryEntry[];
  logs: { at: string; message: string }[]; report: ArtifactRef | null;
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

  constructor(private readonly session: DesktopSession, private readonly artifacts: ArtifactStore, target: DesktopWindow, profile: DesktopProfile, private readonly policy?: DesktopPolicy) {
    const validated = DesktopProfileSchema.parse(profile);
    if (validated.mode === "feedback" && !policy) throw new Error("Feedback mode requires an installed DesktopPolicy; no visual AI provider is configured.");
    this.state = { runId: `desktop-${randomUUID()}`, status: "starting", profile: validated, target, startedAt: new Date().toISOString(), endedAt: null, actionCount: 0, latestAction: null, latestScreenshot: null, reason: "Start delay", history: [], logs: [], report: null };
  }
  start(): Promise<void> {
    if (this.task) throw new Error("Run already started");
    this.task = this.run(); return this.task;
  }
  private log(message: string): void {
    const event = { at: new Date().toISOString(), message };
    this.events.push(event); this.state.logs.push(event); this.state.logs = this.state.logs.slice(-100);
    this.state.reason = message;
  }
  private control(operation: () => Promise<void>): Promise<void> {
    const next = this.controlTask.then(operation); this.controlTask = next.catch(() => undefined); return next;
  }
  pause(reason = "Paused by user"): Promise<void> {
    return this.control(async () => {
      if (!["running", "starting"].includes(this.state.status)) return;
      this.state.status = "paused"; this.step.abort(new Error(reason));
      await this.session.pause(); this.log(reason);
    });
  }
  resume(): Promise<void> {
    return this.control(async () => {
      if (this.state.status !== "paused") return;
      // Focus is only requested after an explicit user resume, never in recovery.
      await this.session.focus(); await delay(200, undefined, { signal: this.abort.signal });
      await this.session.observe(); await this.session.resume();
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
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(new Error("Policy timed out after 15 seconds")), 15000);
    const combined = AbortSignal.any([signal, timeout.signal]);
    let onAbort: () => void = () => undefined;
    try {
      combined.throwIfAborted();
      return await Promise.race([fn(combined), new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason); combined.addEventListener("abort", onAbort, { once: true });
        if (combined.aborted) onAbort();
      })]);
    } finally { clearTimeout(timer); combined.removeEventListener("abort", onAbort); }
  }
  private async capture(): Promise<DesktopObservation> {
    const observation = await this.session.observe();
    // Immutable evidence has both a count and byte budget; subsequent captures update a live image.
    const retain = this.screenshotCount < 100 && this.screenshotBytes + observation.png.length <= 64 * 1024 * 1024;
    const relativePath = retain ? `screenshots/${String(this.screenshotCount++).padStart(4, "0")}.png` : "screenshots/latest.png";
    if (retain) this.screenshotBytes += observation.png.length;
    const ref = await this.artifacts.put({ runId: this.state.runId, kind: "screenshot", relativePath, contentType: "image/png" }, observation.png);
    if (!relativePath.endsWith("latest.png")) this.evidence.push(ref);
    this.state.latestScreenshot = ref;
    this.events.push({ type: "observation", at: observation.capturedAt, sha256: observation.sha256, geometry: observation.geometry, path: ref.relativePath });
    return observation;
  }
  private async interval(ms: number, signal: AbortSignal): Promise<void> {
    for (let remaining = ms; remaining > 0; remaining -= 100) {
      await delay(Math.min(100, remaining), undefined, { signal });
      const health = await this.session.health();
      if (!health.armed) throw new Error(health.reason ?? "Native input disarmed");
    }
  }
  private async run(): Promise<void> {
    this.started = performance.now();
    const p = this.state.profile;
    const deadline = setTimeout(() => this.abort.abort(new Error("Run duration limit reached")), p.maxDurationMs);
    let index = 0;
    try {
      await this.session.bind(this.state.target, p.maxDurationMs);
      await this.artifacts.put({ runId: this.state.runId, kind: "json", relativePath: "reports/configuration.json", contentType: "application/json" }, Buffer.from(JSON.stringify({ target: this.state.target, profile: p }, null, 2)));
      await delay(p.startDelayMs, undefined, { signal: this.abort.signal });
      if (this.state.status === "starting") {
        await this.session.focus(); await delay(200, undefined, { signal: this.abort.signal });
        await this.session.resume(); this.state.status = "running";
      }
      this.log("Target bound; F8 is the emergency stop");
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
            this.log(decision.reason);
            if (decision.type === "complete" || decision.type === "stop") { this.state.status = decision.type === "complete" ? "completed" : "stopped"; break; }
            if (decision.type === "skill") {
              const skill = p.skills.find(s => s.id === decision.skillId);
              if (!skill) throw new Error(`Unknown skill ${decision.skillId}`);
              actions = skill.actions;
            } else actions = decision.actions;
            // Fresh screenshot guards geometry changes while the policy was deciding.
            const fresh = await this.capture();
            if (fresh.geometry !== observation.geometry) throw new Error("Geometry changed during decision");
            observation = fresh;
          } else actions = [p.actions[index % p.actions.length]!];
          const batchBefore = observation;
          for (const action of actions) {
            signal.throwIfAborted();
            if (this.state.actionCount >= p.maxActions) break;
            this.state.latestAction = action;
            // Count attempts before dispatch, including interrupted/failed actions.
            this.state.actionCount++;
            index++;
            this.events.push({ type: "action", at: new Date().toISOString(), action, number: this.state.actionCount });
            await this.session.execute(action, observation.geometry, signal);
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
            const entry = this.state.history.at(-1);
            if (entry) {
              const verification = VerificationSchema.parse(await this.callPolicy(s => this.policy!.verify(this.context(observation), batchBefore, entry.action, s), signal));
              entry.verification = verification.result; entry.reason = verification.reason;
              this.events.push({ type: "policy-verification", ...verification });
              if (verification.result === "no-progress") {
                this.policyFailures++;
                if (this.policyFailures >= 3) { await this.pause("Three decisions without verified progress; inspect or change strategy"); this.policyFailures = 0; }
              } else if (verification.result === "progress") this.policyFailures = 0;
            }
          }
        } catch (error) {
          if (this.abort.signal.aborted) throw error;
          if (["paused"].includes(this.state.status)) continue;
          const health = await this.session.health();
          if (!health.armed && health.reason && /focus|geometry|Paused/i.test(health.reason)) { await this.pause(health.reason); continue; }
          // Input failures are never retried: they may already have had an effect.
          throw error;
        }
      }
      if (this.state.status === "running") { this.state.status = "completed"; this.log("Action limit reached"); }
    } catch (error) {
      const reason = this.abort.signal.aborted ? String(this.abort.signal.reason?.message ?? "Stopped") : error instanceof Error ? error.message : String(error);
      this.state.status = this.abort.signal.aborted || /F8/.test(reason) ? "stopped" : "failed"; this.log(reason);
    } finally {
      clearTimeout(deadline);
      try { await this.session.close(); } catch (error) { this.state.status = "failed"; this.log(`Cleanup failed: ${String(error)}`); }
      this.state.endedAt = new Date().toISOString();
      try {
        this.state.report = await this.artifacts.put({ runId: this.state.runId, kind: "json", relativePath: "reports/desktop-summary.json", contentType: "application/json" }, Buffer.from(JSON.stringify({ ...this.state, evidence: this.evidence, events: this.events }, null, 2)));
      } catch (error) { this.state.status = "failed"; this.log(`Report write failed: ${String(error)}`); }
    }
  }
}
