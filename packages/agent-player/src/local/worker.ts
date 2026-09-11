import { parentPort } from "node:worker_threads";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DemonstrationSchema, LearnedBehaviorSchema, LocalTrainSchema, TeachingIdSchema } from "@game-bots/game-sdk";
import { LocalEngine } from "./engine.js";
import { clearRuntime, forgetDemonstration, LOCAL_LIMITS, LocalMemoryStore, memoryStats, newMemory, type LocalMemory } from "./memory.js";
import { importDemonstration } from "./training.js";

const port = parentPort!;
let engine: LocalEngine | undefined, store: LocalMemoryStore | undefined, root = "", lockFile = "", locked = false;
let lastSave = 0, savedExperiences = 0, dirty = false, checkpointError: string | null = null;
let queue: Promise<unknown> = Promise.resolve();
async function boundedRead(file: string, maxBytes: number) { if ((await stat(file)).size > maxBytes) throw new Error("Local demonstration evidence exceeds its read budget"); return readFile(file); }
async function lock(file: string) {
  await mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const handle = await open(file, "wx"); try { await handle.writeFile(String(process.pid)); } finally { await handle.close(); } lockFile = file; locked = true; return; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(file, "utf8")); let alive = true;
      if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== "ESRCH"; } }
      if (alive) throw new Error("Local behavior is open in another operation or app instance");
      await unlink(file);
    }
  }
  throw new Error("Could not acquire local learning writer lock");
}
async function checkpoint(force = false) {
  if (!engine || !store || !dirty) return;
  if (!force && Date.now() - lastSave < LOCAL_LIMITS.checkpointMs && engine.memory.totals.experiences - savedExperiences < LOCAL_LIMITS.checkpointActions) return;
  try { await store.save(engine.memory); }
  catch (error) { checkpointError = error instanceof Error ? error.message : String(error); throw error; }
  lastSave = Date.now(); savedExperiences = engine.memory.totals.experiences; dirty = false; checkpointError = null;
}
function telemetry() { return { ...engine?.telemetry(), diskBytes: store?.diskBytes ?? 0, recoveredCheckpoint: store?.recovered ?? false, checkpointError }; }
async function command(op: string, input: any): Promise<unknown> {
  if (op === "init") {
    const behavior = LearnedBehaviorSchema.parse(input.behavior); root = z.string().parse(input.root);
    const file = path.join(root, "data", "desktop-local", `${behavior.id}.json`);
    await lock(file + ".lock"); store = new LocalMemoryStore(file);
    let memory: LocalMemory;
    let savedAnnotations: LocalMemory["imports"] = [];
    if (input.reset) {
      memory = newMemory(behavior);
      if (input.reset === "demonstrations") {
        try { const old = await store.load(); if (old) { savedAnnotations = old.imports; memory.region = old.region; } } catch { /* Explicit rebuild can recover when both generations are unusable. */ }
      }
    } else memory = await store.load() ?? newMemory(behavior);
    if (memory.behaviorId !== behavior.id || memory.processName !== behavior.processName || memory.cameraMode !== behavior.cameraMode) throw new Error("Local memory belongs to a different behavior/application");
    engine = new LocalEngine(memory, input.options); await store.cleanTemporary(); lastSave = Date.now(); savedExperiences = memory.totals.experiences;
    return { ...telemetry(), savedAnnotations };
  }
  if (op === "close") {
    try { await checkpoint(true); } finally { if (locked) { await unlink(lockFile); locked = false; } }
    return telemetry();
  }
  if (!engine || !store) throw new Error("Local worker is not initialized");
  if (checkpointError && ["decide", "verify", "validate"].includes(op)) throw new Error(`Local checkpoint failed: ${checkpointError}`);
  switch (op) {
    case "decide": dirty = true; return engine.decide(input.png, input.hash);
    case "validate": return engine.validate(input.png, input.hash);
    case "verify": { const result = engine.verify(input.png, input.hash); dirty = true; await checkpoint(); return result; }
    case "reset": engine.reset(); return null;
    case "checkpoint": await checkpoint(true); return null;
    case "inspect": return { ...memoryStats(engine.memory), ...telemetry(), imports: engine.memory.imports,
      examples: engine.memory.transitions.map(t => ({ id: t.id, demoId: t.demoId, frameId: t.frameId, recovery: t.recovery, prior: t.prior, terminal: t.terminal, disabled: t.disabled, actions: t.actions.map(a => a.kind) })) };
    case "train": {
      const annotations = z.array(LocalTrainSchema).max(100).parse(input.annotations); const results = [];
      for (const annotation of annotations) {
        const id = TeachingIdSchema.parse(annotation.demonstrationId);
        const dir = path.join(root, "artifacts", `desktop-teach-${id}`);
        const demo = DemonstrationSchema.parse(JSON.parse((await boundedRead(path.join(dir, "demonstration.json"), 2 * 1024 * 1024)).toString("utf8")));
        results.push(await importDemonstration(engine.memory, demo, annotation, async frameId => boundedRead(path.join(dir, demo.frames.find(f => f.id === frameId)!.file), 16 * 1024 * 1024)));
      }
      dirty = true;
      // Explicit edits/reset replace both generations; deleted evidence must not reappear on recovery.
      await store.replace(engine.memory); dirty = false; lastSave = Date.now();
      return { ...memoryStats(engine.memory), results };
    }
    case "edit": {
      const edit = z.object({ action: z.enum(["clear-runtime", "forget-demo", "forget-transition", "correct"]), id: z.string().max(100).optional(), outcome: z.enum(["success", "failure", "wrong-state"]).optional() }).strict().parse(input);
      if (edit.action === "clear-runtime") clearRuntime(engine.memory);
      if (edit.action === "forget-demo") forgetDemonstration(engine.memory, TeachingIdSchema.parse(edit.id));
      if (edit.action === "forget-transition") { const t = engine.memory.transitions.find(t => t.id === edit.id); if (!t) throw new Error("Unknown local transition"); t.disabled = true; engine.memory.runtime = engine.memory.runtime.filter(r => r.transitionId !== t.id); }
      if (edit.action === "correct") { if (!edit.id || !edit.outcome) throw new Error("Choose a runtime transition and correction"); engine.correct(edit.id, edit.outcome); }
      engine.reset(); await store.replace(engine.memory); return memoryStats(engine.memory);
    }
    default: throw new Error("Unknown local learning operation");
  }
}
port.on("message", ({ id, op, input }) => {
  queue = queue.then(async () => {
    try { const result = await command(op, input); port.postMessage({ id, result, telemetry: telemetry() }); }
    catch (error) { port.postMessage({ id, error: error instanceof Error ? error.message : String(error), telemetry: telemetry() }); }
  });
});
const timer = setInterval(() => {
  queue = queue.then(() => checkpoint()).catch(error => { checkpointError = String(error); });
}, LOCAL_LIMITS.checkpointMs);
timer.unref();
