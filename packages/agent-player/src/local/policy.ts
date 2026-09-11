import { Worker } from "node:worker_threads";
import type { DesktopObservation } from "@game-bots/environment-sdk";
import type { LearnedBehavior, LocalRunOptions } from "@game-bots/game-sdk";
import type { DesktopDecision, DesktopDecisionContext, DesktopPolicy } from "../application/desktop-runner.js";

/** Worker has pixels and local files only; the guarded runner exclusively owns native input. */
export class LocalWorker {
  private worker = new Worker(new URL("./worker.js", import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 } });
  private sequence = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private dead = false;
  status: Record<string, unknown> = {};
  constructor() {
    this.worker.on("message", ({ id, result, error, telemetry }) => { this.status = telemetry ?? this.status; const p = this.pending.get(id); this.pending.delete(id); if (error) p?.reject(new Error(error)); else p?.resolve(result); });
    this.worker.on("error", error => this.fail(error));
    this.worker.on("exit", () => this.fail(new Error("Local learning worker exited")));
  }
  private fail(error: Error) { this.dead = true; for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
  async call<T = any>(op: string, input: unknown = {}, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted(); if (this.dead) throw new Error("Local worker is closed");
    if (this.pending.size >= 4) throw new Error("Local worker request queue is full");
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => { this.pending.delete(id); clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
      const timer = setTimeout(() => { this.pending.delete(id); signal?.removeEventListener("abort", abort); reject(new Error("Local worker operation timed out")); }, op === "train" ? 300000 : 15000);
      this.pending.set(id, { resolve: result => { clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(result); }, reject: error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); } });
      signal?.addEventListener("abort", abort, { once: true }); this.worker.postMessage({ id, op, input });
    });
  }
  async close() { try { if (!this.dead) await this.call("close"); } finally { await this.worker.terminate(); } }
}
export class LocalDesktopPolicy implements DesktopPolicy {
  readonly boundedBatch = true; readonly managesProgress = true; readonly local = true;
  private constructor(private readonly worker: LocalWorker, private readonly behavior: LearnedBehavior, private readonly options: Partial<LocalRunOptions>) {}
  static async create(root: string, behavior: LearnedBehavior, options: Partial<LocalRunOptions> = {}) {
    const worker = new LocalWorker();
    try { await worker.call("init", { root, behavior, options }); if (!Number(worker.status.states)) throw new Error("Learn locally from a demonstration before starting Local Learned"); return new LocalDesktopPolicy(worker, behavior, options); }
    catch (error) { await worker.close().catch(() => undefined); throw error; }
  }
  telemetry() { return this.worker.status; }
  configuration() { return { mode: "local", apiRequired: false, behaviorId: this.behavior.id, options: this.options, version: 2 }; }
  reset() { void this.worker.call("reset").catch(() => undefined); }
  async checkpoint() { await this.worker.call("checkpoint"); }
  async close() { await this.worker.close(); }
  async decide(context: DesktopDecisionContext, signal: AbortSignal): Promise<DesktopDecision> {
    if (Date.now() - Date.parse(context.observation.capturedAt) > 5000) return { type: "pause", reason: "Local observation is stale" };
    const decision = await this.worker.call<DesktopDecision>("decide", { png: context.observation.png, hash: context.observation.sha256 }, signal);
    signal.throwIfAborted();
    if (Date.now() - Date.parse(context.observation.capturedAt) > 5000) return { type: "pause", reason: "Local decision took too long; inspect vision latency" };
    return decision;
  }
  async validateObservation(observation: DesktopObservation, signal: AbortSignal) { return this.worker.call<boolean>("validate", { png: observation.png, hash: observation.sha256 }, signal); }
  async verify(context: DesktopDecisionContext, _before: DesktopObservation, _action: unknown, signal: AbortSignal) {
    return this.worker.call<{ result: "progress" | "no-progress" | "unknown"; reason: string }>("verify", { png: context.observation.png, hash: context.observation.sha256 }, signal);
  }
}
