import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BehaviorReviewSchema, DemonstrationSchema, LearnedBehaviorSchema, TeachingIdSchema, TeachingOutcomeSchema, TeachingStartSchema, type Demonstration, type LearnedBehavior } from "@game-bots/game-sdk";
import { createVisualModel, learnDemonstration, selectTeachingFrames, visualModelStatus, type VisualModel, type VisualImage } from "@game-bots/agent-player";
import type { DesktopRecorder, DesktopWindow, RecordingState } from "@game-bots/environment-sdk";

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2)); await rename(temporary, file);
}
export class DesktopBehaviorStore {
  constructor(private readonly root: string) {}
  private file(id: string) { return path.join(this.root, "data/desktop-behaviors", `${TeachingIdSchema.parse(id)}.json`); }
  evidenceDir(id: string) { return path.join(this.root, "artifacts", `desktop-teach-${TeachingIdSchema.parse(id)}`); }
  async get(id: string): Promise<LearnedBehavior> { return LearnedBehaviorSchema.parse(JSON.parse(await readFile(this.file(id), "utf8"))); }
  async save(behavior: LearnedBehavior) { const parsed = LearnedBehaviorSchema.parse(behavior); await atomicJson(this.file(parsed.id), parsed); return parsed; }
  async list() {
    const dir = path.join(this.root, "data/desktop-behaviors"); await mkdir(dir, { recursive: true });
    const values: LearnedBehavior[] = [];
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".json")) continue;
      try { values.push(await this.get(file.slice(0, -5))); } catch { /* Invalid local files never become executable. */ }
    }
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async demonstration(id: string): Promise<Demonstration> { return DemonstrationSchema.parse(JSON.parse(await readFile(path.join(this.evidenceDir(id), "demonstration.json"), "utf8"))); }
  async saveDemonstration(demo: Demonstration) { await atomicJson(path.join(this.evidenceDir(demo.id), "demonstration.json"), DemonstrationSchema.parse(demo)); }
  async image(demo: Demonstration, frameId: number): Promise<VisualImage> {
    const frame = demo.frames.find(f => f.id === frameId); if (!frame) throw new Error("Demonstration image is missing");
    return { label: `DEMONSTRATION ${demo.id} frame ${frame.id}, ${frame.atMs}ms, ${demo.outcome} example (historical)`, png: await readFile(path.join(this.evidenceDir(demo.id), frame.file)) };
  }
  async references(behavior: LearnedBehavior) {
    // Recent successful examples retain both target and completion visual references.
    const example = [...behavior.examples].reverse().find(e => e.outcome === "success" && e.procedure);
    if (!example) return [];
    const demo = await this.demonstration(example.demonstrationId);
    const ids = [example.procedure!.steps[0]!.evidenceFrames[0]!, demo.frames.at(-1)!.id];
    return Promise.all([...new Set(ids)].map(id => this.image(demo, id)));
  }
}

/** Shares the recorder's lease, focus guard and timeline; never opens a second controller. */
export class DesktopTeachingManager {
  readonly store: DesktopBehaviorStore;
  private current: Demonstration | null = null;
  private phase: "idle" | "capturing" | "outcome" | "analyzing" | "ready" | "error" = "idle";
  private error: string | null = null;
  private bytes = 0;
  private analysis: AbortController | undefined;
  private task: Promise<void> | undefined;
  private saving = false;
  constructor(root: string, private readonly modelFactory: () => VisualModel = createVisualModel) { this.store = new DesktopBehaviorStore(root); }
  snapshot() { return { phase: this.phase, error: this.error, behaviorId: this.current?.behaviorId ?? null, demonstrationId: this.current?.id ?? null,
    frameCount: this.current?.frames.length ?? 0, evidencePath: this.current ? `desktop-teach-${this.current.id}/demonstration.json` : null, provider: visualModelStatus() }; }
  get busy() { return this.phase === "capturing" || this.phase === "analyzing" || this.saving; }
  async begin(raw: unknown, target: DesktopWindow) {
    if (this.busy) throw new Error("Stop teaching or cancel analysis first");
    const input = TeachingStartSchema.parse(raw);
    const existing = input.behaviorId ? await this.store.get(input.behaviorId) : null;
    if (existing && (existing.processName !== target.processName || existing.cameraMode !== input.cameraMode)) throw new Error("Additional demonstrations must use the same application and camera mode");
    if (existing && existing.examples.length >= 100) throw new Error("Behavior demonstration limit reached");
    const behavior = existing ?? LearnedBehaviorSchema.parse({ version: 1, id: randomUUID(), name: input.name, goal: input.goal,
      processName: target.processName, cameraMode: input.cameraMode, examples: [], updatedAt: new Date().toISOString() });
    await this.store.save(behavior);
    this.current = { version: 1, id: randomUUID(), behaviorId: behavior.id, name: behavior.name, goal: existing?.goal ?? input.goal,
      cameraMode: input.cameraMode, target, createdAt: new Date().toISOString(), endedAt: "", outcome: "uncertain", outcomeNote: "",
      captureReason: "", frames: [], events: [], warnings: [] };
    this.bytes = 0; this.error = null; this.phase = "capturing";
    await mkdir(path.join(this.store.evidenceDir(this.current.id), "frames"), { recursive: true });
  }
  async drain(recorder: DesktopRecorder) {
    if (this.phase !== "capturing" || !this.current) return;
    if (!recorder.recordingFrames) throw new Error("Native teaching capture unavailable; rebuild with pnpm desktop:setup");
    for (const frame of await recorder.recordingFrames()) {
      if (frame.window.handle !== this.current.target.handle || frame.window.pid !== this.current.target.pid || frame.window.processStartedAt !== this.current.target.processStartedAt) throw new Error("Teaching frame target identity mismatch");
      if (this.current.frames.length >= 160 || this.bytes + frame.png.length > 64 * 1024 * 1024) {
        if (!this.current.warnings.includes("Screenshot budget reached")) this.current.warnings.push("Screenshot budget reached"); continue;
      }
      const previous = this.current.frames.at(-1);
      // Preserve action-state transitions even if pixels match (e.g. blocked movement).
      if (previous?.sha256 === frame.sha256 && previous.eventCount === frame.eventCount) continue;
      const id = this.current.frames.length; const file = `frames/${id}.png`;
      await writeFile(path.join(this.store.evidenceDir(this.current.id), file), frame.png); this.bytes += frame.png.length;
      this.current.frames.push({ id, atMs: frame.atMs, capturedAt: frame.capturedAt, eventCount: frame.eventCount, geometry: frame.geometry,
        sha256: frame.sha256, file, heldKeys: frame.heldKeys, heldButtons: frame.heldButtons as ("left" | "right" | "middle")[] });
    }
  }
  async finish(recorder: DesktopRecorder, state: RecordingState) {
    if (this.phase !== "capturing" || !this.current) return;
    try { await this.drain(recorder); }
    catch { this.current.warnings.push("Could not drain final native frames; some visual evidence may be missing"); }
    this.current.events = state.events ?? []; this.current.endedAt = new Date().toISOString(); this.current.captureReason = state.reason;
    if (state.status === "failed") this.current.warnings.push(state.reason);
    const tail = this.current.events.at(-1)?.atMs ?? 0;
    if (tail - (this.current.frames.at(-1)?.atMs ?? 0) > 1500) this.current.warnings.push("The final input is not closely covered by a screenshot; completion may be ambiguous");
    if (this.current.frames.length >= 158) this.current.warnings.push("Native frame limit reached; later visual states may be missing");
    await this.store.saveDemonstration(this.current);
    const behavior = await this.store.get(this.current.behaviorId);
    behavior.examples.push({ demonstrationId: this.current.id, outcome: "uncertain", procedure: null, analyzedAt: null, model: null, provider: null });
    behavior.updatedAt = new Date().toISOString(); await this.store.save(behavior);
    this.phase = "outcome";
  }
  async analyze(id: string, demonstrationId: string, rawOutcome: unknown) {
    if (this.busy) throw new Error("Another teaching operation is active");
    this.saving = true;
    try {
      const outcome = TeachingOutcomeSchema.parse(rawOutcome);
      const behavior = await this.store.get(id); const demo = await this.store.demonstration(demonstrationId);
      if (demo.behaviorId !== behavior.id || !behavior.examples.some(e => e.demonstrationId === demo.id)) throw new Error("Demonstration does not belong to this behavior");
      Object.assign(demo, outcome); await this.store.saveDemonstration(demo);
      const example = behavior.examples.find(e => e.demonstrationId === demo.id)!;
      example.outcome = demo.outcome; example.procedure = null; behavior.reviewed = false;
      await this.store.save(behavior);
      this.current = demo; this.error = null;
      const model = this.modelFactory(); const controller = new AbortController(); this.analysis = controller; this.phase = "analyzing";
      this.task = (async () => {
        try {
          const images = await Promise.all(selectTeachingFrames(demo).map(frame => this.store.image(demo, frame.id)));
          const procedure = await learnDemonstration(model, { demonstration: demo, images }, controller.signal);
          controller.signal.throwIfAborted();
          example.procedure = procedure; example.analyzedAt = new Date().toISOString(); example.model = model.model; example.provider = model.provider;
          if (!behavior.goal) behavior.goal = procedure.goal;
          if (!behavior.completionOverride) behavior.completionOverride = procedure.completion.join("\n");
          behavior.updatedAt = new Date().toISOString();
          await this.store.save(behavior); this.phase = "ready";
        } catch (error) { this.phase = "error"; this.error = controller.signal.aborted ? "Analysis cancelled; demonstration retained" : error instanceof Error ? error.message : "Analysis failed"; }
        finally { this.analysis = undefined; }
      })();
    } catch (error) { this.phase = "error"; this.error = error instanceof Error ? error.message : "Analysis unavailable"; throw error; }
    finally { this.saving = false; }
    return this.snapshot();
  }
  async review(raw: unknown) {
    if (this.busy) throw new Error("Wait for teaching analysis to finish");
    const review = BehaviorReviewSchema.parse(raw); const behavior = await this.store.get(review.id);
    if (!behavior.examples.some(e => e.outcome === "success" && e.procedure)) throw new Error("Analyze a successful demonstration before saving a usable behavior");
    return this.store.save({ ...behavior, goal: review.goal, completionOverride: review.completionOverride, reviewed: true, updatedAt: new Date().toISOString() });
  }
  async cancelAnalysis() { this.analysis?.abort(); await this.task; }
  fail(message: string) { this.phase = "error"; this.error = message; }
  discard() { if (this.phase === "analyzing") throw new Error("Cancel analysis first"); this.phase = "idle"; this.current = null; this.error = null; }
}
