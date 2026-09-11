import { mkdir, readdir, readFile, writeFile, rename, rm, unlink, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TeachingIdSchema } from "@game-bots/game-sdk";
import { DesktopBehaviorStore } from "./desktop-teaching-manager.js";
import { DesktopLocalManager } from "./desktop-local-manager.js";

export const DeleteDemonstrationSchema = z.object({ behaviorId: TeachingIdSchema, demonstrationId: TeachingIdSchema, confirm: z.literal(true) }).strict();
/** Durable delete intent. Replay before exposing behaviors after a server restart. */
export class DesktopDemonstrationDeletion {
  private readonly store: DesktopBehaviorStore;
  private readonly journal: string;
  constructor(private readonly root: string) { this.store = new DesktopBehaviorStore(root); this.journal = path.join(root, "data/desktop-demonstration-deletions"); }
  async recover() {
    await mkdir(this.journal, { recursive: true });
    for (const file of await readdir(this.journal)) if (file.endsWith(".json")) {
      const request = DeleteDemonstrationSchema.parse(JSON.parse(await readFile(path.join(this.journal, file), "utf8")));
      if (file !== `${request.demonstrationId}.json`) throw new Error("Invalid demonstration deletion journal identity");
      await this.complete(request);
    }
  }
  async delete(raw: unknown) {
    const request = DeleteDemonstrationSchema.parse(raw), behavior = await this.store.get(request.behaviorId);
    if (!behavior.examples.some(e => e.demonstrationId === request.demonstrationId)) throw new Error("Demonstration does not belong to this behavior");
    const demo = await this.store.demonstration(request.demonstrationId);
    if (demo.behaviorId !== behavior.id) throw new Error("Demonstration ownership mismatch");
    await mkdir(this.journal, { recursive: true });
    const file = path.join(this.journal, `${request.demonstrationId}.json`);
    await writeFile(file + ".tmp", JSON.stringify(request)); await rename(file + ".tmp", file);
    await this.complete(request);
    return { deleted: request.demonstrationId, behaviorId: behavior.id };
  }
  private async complete(request: z.infer<typeof DeleteDemonstrationSchema>) {
    // Clear every stored reference, including any legacy cross-behavior reference.
    for (const behavior of await this.store.list()) {
      if (behavior.id !== request.behaviorId && !behavior.examples.some(e => e.demonstrationId === request.demonstrationId)) continue;
      await new DesktopLocalManager(this.root).operation({ behaviorId: behavior.id, action: "forget-demo", id: request.demonstrationId });
      behavior.examples = behavior.examples.filter(e => e.demonstrationId !== request.demonstrationId);
      behavior.reviewed = false; behavior.updatedAt = new Date().toISOString(); await this.store.save(behavior);
    }
    const dir = path.resolve(this.store.evidenceDir(request.demonstrationId));
    const artifacts = await realpath(path.join(this.root, "artifacts"));
    let resolved: string;
    try { resolved = await realpath(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; resolved = path.join(artifacts, path.basename(dir)); }
    if (path.dirname(resolved) !== artifacts || path.basename(resolved) !== `desktop-teach-${request.demonstrationId}`) throw new Error("Unsafe demonstration evidence directory");
    await rm(dir, { recursive: true, force: true });
    await unlink(path.join(this.journal, `${request.demonstrationId}.json`));
  }
}
