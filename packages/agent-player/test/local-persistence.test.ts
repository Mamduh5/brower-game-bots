import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMemoryStore, LocalMemorySchema } from "../src/local/memory.js";
import { memoryFixture } from "./local-fixtures.js";

const roots: string[] = [];
async function setup() { const root = await mkdtemp(path.join(os.tmpdir(), "game-bots-local-store-")); roots.push(root); return new LocalMemoryStore(path.join(root, "memory.json")); }
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "game-bots-local-store-")) throw new Error("Unsafe test cleanup"); await rm(root, { recursive: true, force: true }); } });
describe("local durable memory", () => {
  it("migrates version 1 without reinterpreting legacy target pixels and writes version 2", async () => {
    const store = await setup(), { m } = memoryFixture();
    m.targets.push({ id: "legacy", rgb: Array.from({ length: 243 }, (_, i) => i % 2), width: .1, height: .1 });
    m.transitions[0]!.targetId = "legacy";
    const payload = JSON.stringify({ ...m, version: 1 });
    await writeFile(store.file, JSON.stringify({ payload, checksum: createHash("sha256").update(payload).digest("hex") }));
    const loaded = (await store.load())!;
    expect(loaded.version).toBe(2); expect(loaded.targets[0]?.detailVersion).toBeUndefined();
    expect(loaded.targets[0]?.rgb).toEqual(m.targets[0]?.rgb);
    await store.save(loaded); expect(JSON.parse(JSON.parse(await readFile(store.file, "utf8")).payload).version).toBe(2);
  });
  it("persists compact learned state across store instances with a checkpoint timestamp", async () => {
    const store = await setup(), { m } = memoryFixture(); await store.save(m);
    const loaded = await new LocalMemoryStore(store.file).load(); expect(loaded).toEqual(m); expect(loaded?.checkpointAt).not.toBeNull(); expect(store.diskBytes).toBeGreaterThan(100);
  });
  it("recovers the last valid generation after a torn primary write and ignores temp files", async () => {
    const store = await setup(), { m } = memoryFixture(); await store.save(m); m.totals.experiences = 10; await store.save(m);
    await writeFile(store.file, "broken"); await writeFile(store.file + ".tmp", "partial checkpoint");
    const recovered = new LocalMemoryStore(store.file), value = await recovered.load(); expect(recovered.recovered).toBe(true); expect(value?.totals.experiences).toBe(0);
    await recovered.save(value!); expect((await recovered.load())?.totals.experiences).toBe(0);
  });
  it("fails closed for both corrupt generations and does not silently downgrade future formats", async () => {
    const store = await setup(), { m } = memoryFixture(); await store.replace(m);
    const payload = JSON.stringify({ ...m, version: 999 }); await writeFile(store.file, JSON.stringify({ payload, checksum: createHash("sha256").update(payload).digest("hex") }));
    await expect(store.load()).rejects.toThrow(/Unsupported/);
    await writeFile(store.file, "bad"); await writeFile(store.file + ".bak", "also bad"); await expect(store.load()).rejects.toThrow(/corrupt/);
  });
  it("detects tampering and invalid references/action contracts", async () => {
    const store = await setup(), { m } = memoryFixture(); await store.save(m);
    const envelope = JSON.parse(await readFile(store.file, "utf8")); envelope.payload += " "; await writeFile(store.file, JSON.stringify(envelope)); await expect(store.load()).rejects.toThrow(/corrupt/);
    m.transitions[0]!.targetId = "absent"; expect(LocalMemorySchema.safeParse(m).success).toBe(false);
  });
  it("reset replaces both generations so forgotten runtime knowledge cannot resurrect", async () => {
    const store = await setup(), { m } = memoryFixture(); m.totals.experiences = 50; await store.save(m); m.totals.experiences = 0; await store.replace(m);
    await writeFile(store.file, "torn"); expect((await store.load())?.totals.experiences).toBe(0);
  });
  it("returns empty only for a genuinely new store", async () => { expect(await (await setup()).load()).toBeNull(); });
});
