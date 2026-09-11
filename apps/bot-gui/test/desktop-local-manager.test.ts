import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LearnedBehaviorSchema } from "@game-bots/game-sdk";
import { LocalWorker, LocalDesktopPolicy } from "@game-bots/agent-player";
import { DesktopBehaviorStore } from "../src/desktop-teaching-manager.js";
import { DesktopLocalManager } from "../src/desktop-local-manager.js";
import { DesktopDemonstrationDeletion } from "../src/desktop-demonstration-deletion.js";
import { pruneLocalRunArtifacts } from "../src/desktop-local-retention.js";
import { behavior, demonstration, scene, sha } from "../../../packages/agent-player/test/local-fixtures.js";

const roots: string[] = [], workers: LocalWorker[] = [];
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.close().catch(() => undefined);
  for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "game-bots-local-manager-")) throw new Error("Unsafe test cleanup"); await rm(root, { recursive: true, force: true }); }
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "game-bots-local-manager-")); roots.push(root);
  const store = new DesktopBehaviorStore(root), demo = demonstration(), images = [scene(), scene(1)];
  const saved = LearnedBehaviorSchema.parse({ version: 1, ...behavior, name: "synthetic", goal: "change panel", updatedAt: new Date().toISOString(), examples: [{ demonstrationId: demo.id, outcome: "success", procedure: null, analyzedAt: null, model: null, provider: null }] });
  await store.save(saved); await store.saveDemonstration(demo); await mkdir(path.join(store.evidenceDir(demo.id), "frames"));
  for (const frame of demo.frames) await writeFile(path.join(store.evidenceDir(demo.id), frame.file), images[frame.id]!);
  return { root, manager: new DesktopLocalManager(root), saved, demo };
}
describe("local worker and GUI service (synthetic files, no native controller)", () => {
  it("forgets without deleting source, then deletes source and references durably", async () => {
    const { manager, root, saved, demo } = await setup(), store = new DesktopBehaviorStore(root);
    const other = demonstration(); await store.saveDemonstration(other);
    saved.examples.push({ demonstrationId: other.id, outcome: "uncertain", procedure: null, analyzedAt: null, model: null, provider: null }); await store.save(saved);
    await manager.operation({ behaviorId: saved.id, action: "train", training: { behaviorId: saved.id, demonstrationId: demo.id } });
    await manager.operation({ behaviorId: saved.id, action: "forget-demo", id: demo.id });
    expect((await manager.operation({ behaviorId: saved.id, action: "inspect" })).states).toBe(0);
    expect((await store.demonstration(demo.id)).frames).toHaveLength(2);
    await manager.operation({ behaviorId: saved.id, action: "train", training: { behaviorId: saved.id, demonstrationId: demo.id } });
    const deletion = new DesktopDemonstrationDeletion(root);
    await expect(deletion.delete({ behaviorId: saved.id, demonstrationId: demo.id })).rejects.toThrow();
    await deletion.delete({ behaviorId: saved.id, demonstrationId: demo.id, confirm: true });
    await new DesktopDemonstrationDeletion(root).recover();
    expect((await new DesktopBehaviorStore(root).get(saved.id)).examples.map(e => e.demonstrationId)).toEqual([other.id]);
    expect((await store.demonstration(other.id)).id).toBe(other.id);
    await expect(store.demonstration(demo.id)).rejects.toThrow();
    await expect(readFile(path.join(store.evidenceDir(demo.id), "frames/0.png"))).rejects.toThrow();
    const local = await manager.operation({ behaviorId: saved.id, action: "inspect" });
    expect(local.imports).toHaveLength(0); expect(local.targets).toBe(0); expect(local.runtimeStates).toBe(0);
    // Force backup recovery: forgotten source must not reappear in the fallback generation.
    await writeFile(path.join(root, "data/desktop-local", `${saved.id}.json`), "invalid");
    expect((await manager.operation({ behaviorId: saved.id, action: "inspect" })).imports).toHaveLength(0);
  });
  it("replays interrupted deletion intent after restart", async () => {
    const { root, saved, demo, manager } = await setup();
    await manager.operation({ behaviorId: saved.id, action: "train" });
    const journal = path.join(root, "data/desktop-demonstration-deletions"); await mkdir(journal);
    await writeFile(path.join(journal, `${demo.id}.json`), JSON.stringify({ behaviorId: saved.id, demonstrationId: demo.id, confirm: true }));
    await new DesktopDemonstrationDeletion(root).recover();
    expect((await new DesktopBehaviorStore(root).get(saved.id)).examples).toHaveLength(0);
    expect((await manager.operation({ behaviorId: saved.id, action: "inspect" })).states).toBe(0);
  });
  it("prunes only completed local reports and leaves macro and teaching artifacts intact", async () => {
    const { root } = await setup(); const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
    for (const [i, id] of ids.entries()) { const dir = path.join(root, "artifacts", `desktop-${id}`, "reports"); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, "desktop-summary.json"), JSON.stringify({ profile: { mode: i === 2 ? "automation" : "local" }, endedAt: `2026-09-0${i + 1}T00:00:00.000Z` })); }
    expect(await pruneLocalRunArtifacts(root, 1)).toBe(1);
    await expect(readFile(path.join(root, "artifacts", `desktop-${ids[0]}`, "reports/desktop-summary.json"))).rejects.toThrow();
    expect(await readFile(path.join(root, "artifacts", `desktop-${ids[2]}`, "reports/desktop-summary.json"), "utf8")).toContain("automation");
  });
  it("trains unreviewed demonstrations without AI analysis, restarts, corrects and resets without deleting evidence", async () => {
    const { manager, root, saved, demo } = await setup();
    const result = await manager.operation({ behaviorId: saved.id, action: "train", training: { behaviorId: saved.id, demonstrationId: demo.id, outcome: "success", recovery: true } }); expect(result.states).toBe(1);
    const worker = new LocalWorker(); workers.push(worker); await worker.call("init", { root, behavior: saved });
    const png = scene(); expect((await worker.call("decide", { png, hash: sha(png) })).type).toBe("act"); await worker.call("verify", { png: scene(1), hash: sha(scene(1)) }); await worker.call("checkpoint"); await worker.close(); workers.splice(workers.indexOf(worker), 1);
    const inspect = await manager.operation({ behaviorId: saved.id, action: "inspect" }); expect(inspect.experiences).toBe(1); expect(inspect.apiRequired).toBe(false);
    await manager.operation({ behaviorId: saved.id, action: "correct", id: inspect.examples[0].id, outcome: "failure" });
    const reset = await manager.operation({ behaviorId: saved.id, action: "reset-demonstrations" }); expect(reset.experiences).toBe(0); expect(reset.recoveries).toBe(1);
    await manager.operation({ behaviorId: saved.id, action: "full-reset" }); expect((await manager.operation({ behaviorId: saved.id, action: "inspect" })).states).toBe(0);
    expect(JSON.parse(await readFile(path.join(root, "artifacts", `desktop-teach-${demo.id}`, "demonstration.json"), "utf8")).id).toBe(demo.id);
  });
  it("enforces a single writer and releases the lease after close", async () => {
    const { root, saved } = await setup(); const a = new LocalWorker(), b = new LocalWorker(); workers.push(a, b);
    await a.call("init", { root, behavior: saved }); await expect(b.call("init", { root, behavior: saved })).rejects.toThrow(/another/);
    await a.close(); workers.splice(workers.indexOf(a), 1); await b.call("init", { root, behavior: saved });
  });
  it("rejects cancellation before sending a policy request and preserves shutdown", async () => {
    const { manager, root, saved } = await setup(); await manager.operation({ behaviorId: saved.id, action: "train" });
    const policy = await LocalDesktopPolicy.create(root, saved);
    const c = new AbortController(); c.abort(new Error("cancelled"));
    try { await expect(policy.decide({ observation: { capturedAt: new Date().toISOString(), png: scene(), sha256: sha(scene()) } } as any, c.signal)).rejects.toThrow(/cancelled/); }
    finally { await policy.close(); }
  });
});
