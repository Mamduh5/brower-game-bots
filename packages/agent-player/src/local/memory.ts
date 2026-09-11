import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DesktopActionSchema, DesktopPointSchema } from "@game-bots/environment-sdk";
import { LocalRegionSchema, LocalTrainSchema, TeachingIdSchema } from "@game-bots/game-sdk";
import { FEATURE_SIZE } from "./vision.js";

export const LOCAL_LIMITS = { transitions: 1024, runtime: 256, targets: 64, fileBytes: 12 * 1024 * 1024, checkpointMs: 30000, checkpointActions: 25 } as const;
const feature = z.array(z.number().finite().min(0).max(1)).length(FEATURE_SIZE);
const count = z.number().finite().nonnegative().max(1e12);
export const LocalMemorySchema = z.object({
  version: z.literal(2), behaviorId: TeachingIdSchema, processName: z.string().max(300), cameraMode: z.enum(["pointer", "relative"]),
  region: LocalRegionSchema, checkpointAt: z.string().nullable(),
  imports: z.array(z.object({ id: TeachingIdSchema, hash: z.string().max(64), annotation: LocalTrainSchema }).strict()).max(100),
  targets: z.array(z.object({ id: z.string().max(64), rgb: z.array(z.number().min(0).max(1)).length(243), width: z.number().min(.03).max(.4), height: z.number().min(.03).max(.4), detailVersion: z.literal(2).optional() }).strict()).max(LOCAL_LIMITS.targets),
  transitions: z.array(z.object({
    id: z.string().max(100), demoId: TeachingIdSchema, frameId: z.number().int().nonnegative(), before: feature, after: feature,
    actions: z.array(DesktopActionSchema).min(1).max(8), targetId: z.string().max(64).nullable(),
    targetBefore: DesktopPointSchema.nullable(), targetAfter: DesktopPointSchema.nullable(),
    recovery: z.boolean(), prior: z.enum(["success", "failure", "uncertain"]), terminal: z.boolean(),
    samples: count, disabled: z.boolean()
  }).strict()).max(LOCAL_LIMITS.transitions),
  runtime: z.array(z.object({ transitionId: z.string().max(100), before: feature, after: feature, positive: count, negative: count, neutral: count, uncertain: count, updatedAt: z.string() }).strict()).max(LOCAL_LIMITS.runtime),
  totals: z.object({ observations: count, experiences: count, positive: count, negative: count, uncertain: count, neutral: count, unknown: count, stuck: count, successes: count, evicted: count, skipped: count }).strict()
}).strict().superRefine((m, ctx) => {
  const ids = new Set(m.transitions.map(t => t.id)), targets = new Set(m.targets.map(t => t.id)), demos = new Set(m.imports.map(i => i.id));
  if (ids.size !== m.transitions.length || targets.size !== m.targets.length || demos.size !== m.imports.length) ctx.addIssue({ code: "custom", message: "Duplicate local memory identity" });
  for (const t of m.transitions) {
    if (!demos.has(t.demoId) || (t.targetId && !targets.has(t.targetId))) ctx.addIssue({ code: "custom", message: "Missing local evidence reference" });
    const duration = t.actions.reduce((n, a) => n + ("durationMs" in a ? a.durationMs : 0), 0);
    if (duration > 1000 || t.actions.some(a => ["key-down", "key-up", "drag", "button-up"].includes(a.kind))) ctx.addIssue({ code: "custom", message: "Unbounded local skill" });
    if (t.actions.some(a => a.kind === "button-down") && t.actions.at(-1)?.kind !== "release-all") ctx.addIssue({ code: "custom", message: "Local skill must release buttons" });
    if (t.actions.some(a => a.kind === "hold" && (a.keys.length > 4 || a.keys.some(k => /^(F\d+|Alt|Control)$/.test(k))))) ctx.addIssue({ code: "custom", message: "Reserved local control" });
    if (t.actions.some(a => a.kind === "click") && !t.targetId) ctx.addIssue({ code: "custom", message: "Local click requires a visual target" });
  }
  if (m.runtime.some(r => !ids.has(r.transitionId))) ctx.addIssue({ code: "custom", message: "Orphan runtime experience" });
});
export type LocalMemory = z.infer<typeof LocalMemorySchema>;
export type Transition = LocalMemory["transitions"][number];
export function newMemory(behavior: { id: string; processName: string; cameraMode: "pointer" | "relative" }): LocalMemory {
  return { version: 2, behaviorId: behavior.id, processName: behavior.processName, cameraMode: behavior.cameraMode,
    region: { x: 0, y: 0, width: 1, height: 1 }, checkpointAt: null, imports: [], targets: [], transitions: [], runtime: [],
    totals: { observations: 0, experiences: 0, positive: 0, negative: 0, uncertain: 0, neutral: 0, unknown: 0, stuck: 0, successes: 0, evicted: 0, skipped: 0 } };
}
export function clearRuntime(m: LocalMemory) { m.runtime = []; m.totals = newMemory({ id: m.behaviorId, processName: m.processName, cameraMode: m.cameraMode }).totals; }
export function forgetDemonstration(m: LocalMemory, id: string) {
  m.transitions = m.transitions.filter(t => t.demoId !== id); m.imports = m.imports.filter(i => i.id !== id);
  pruneMemory(m);
}
export function pruneMemory(m: LocalMemory) {
  const ids = new Set(m.transitions.map(t => t.id)), targets = new Set(m.transitions.map(t => t.targetId));
  m.runtime = m.runtime.filter(r => ids.has(r.transitionId)); m.targets = m.targets.filter(t => targets.has(t.id));
}
export function memoryStats(m: LocalMemory) {
  return { mode: "local", apiRequired: false, behaviorId: m.behaviorId, states: m.transitions.length, demonstrations: m.imports.length,
    targets: m.targets.length, recoveries: m.transitions.filter(t => t.recovery).length, successDetectors: m.transitions.filter(t => t.terminal).length, runtimeStates: m.runtime.length,
    checkpointAt: m.checkpointAt, ...m.totals, memoryBytes: Buffer.byteLength(JSON.stringify(m)) };
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Two checksummed generations. Torn temp files are never read as knowledge. One writer per behavior. */
export class LocalMemoryStore {
  recovered = false;
  diskBytes = 0;
  constructor(readonly file: string) {}
  private async read(file: string): Promise<LocalMemory> {
    if ((await stat(file)).size > LOCAL_LIMITS.fileBytes) throw new Error("Local memory exceeds its size limit");
    const envelope = z.object({ checksum: z.string(), payload: z.string() }).strict().parse(JSON.parse(await readFile(file, "utf8")));
    if (hash(envelope.payload) !== envelope.checksum) throw new Error("Local memory checksum failed");
    const raw = JSON.parse(envelope.payload);
    if (raw.version !== 1 && raw.version !== 2) throw new Error(`Unsupported local memory version ${String(raw.version)}; reset or use a compatible version`);
    // Legacy patches keep their original sampling plane; only reimport creates detail patches.
    if (raw.version === 1) raw.version = 2;
    return LocalMemorySchema.parse(raw);
  }
  async load(): Promise<LocalMemory | null> {
    let primaryError: unknown;
    try { const m = await this.read(this.file); await this.measure(); return m; } catch (error) { primaryError = error; }
    // Unknown future formats must not be silently downgraded to old backup knowledge.
    if (primaryError instanceof Error && primaryError.message.startsWith("Unsupported")) throw primaryError;
    try { const m = await this.read(this.file + ".bak"); this.recovered = true; await this.measure(); return m; }
    catch (backupError) {
      if ((primaryError as NodeJS.ErrnoException).code === "ENOENT" && (backupError as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("Local memory is corrupt or incompatible in both generations; original demonstrations are intact. Use Reset to demonstrations.");
    }
  }
  private async atomic(file: string, text: string) {
    const temp = file + ".tmp";
    const handle = await open(temp, "w");
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file);
  }
  async save(memory: LocalMemory) {
    const value = LocalMemorySchema.parse({ ...memory, checkpointAt: new Date().toISOString() });
    const payload = JSON.stringify(value), text = JSON.stringify({ checksum: hash(payload), payload });
    if (Buffer.byteLength(text) > LOCAL_LIMITS.fileBytes) throw new Error("Local learning checkpoint exceeds storage budget");
    await mkdir(path.dirname(this.file), { recursive: true });
    // Only validated prior state can replace the backup; corruption never propagates.
    try { await this.read(this.file); await this.atomic(this.file + ".bak", await readFile(this.file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof z.ZodError) && !(error instanceof SyntaxError) && !(error instanceof Error && /checksum|Unsupported|size limit/.test(error.message))) throw error; }
    await this.atomic(this.file, text); memory.checkpointAt = value.checkpointAt; await this.measure();
  }
  /** Explicit reset must also replace backup, so forgotten knowledge cannot resurrect. */
  async replace(memory: LocalMemory) { await this.save(memory); await this.atomic(this.file + ".bak", await readFile(this.file, "utf8")); await this.measure(); }
  async measure() { this.diskBytes = 0; for (const suffix of ["", ".bak", ".tmp", ".bak.tmp"]) { try { this.diskBytes += (await stat(this.file + suffix)).size; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } } }
  async cleanTemporary() { for (const suffix of [".tmp", ".bak.tmp"]) await unlink(this.file + suffix).catch(e => { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }); }
}
