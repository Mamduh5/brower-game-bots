import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DesktopRunner, LearnedDesktopPolicy, LocalDesktopPolicy, createVisualModel, type DesktopRunState, type DesktopPolicy } from "@game-bots/agent-player";
import { DesktopBehaviorStore } from "./desktop-teaching-manager.js";
import { WindowsDesktopSession } from "@game-bots/environment-windows";
import { DesktopProfileSchema, DesktopRunRequestSchema } from "@game-bots/game-sdk";
import { FsArtifactStore } from "@game-bots/artifact-store-fs";
import { DesktopWindowSchema, type DesktopWindow } from "@game-bots/environment-sdk";
import { pruneLocalRunArtifacts } from "./desktop-local-retention.js";

export class DesktopManager {
  private runner: DesktopRunner | undefined;
  private starting = false;
  private readonly profilesDir: string;
  constructor(private readonly repoRoot: string) { this.profilesDir = path.join(repoRoot, "data", "desktop-profiles"); }
  state(): DesktopRunState | null { return this.runner?.state ?? null; }
  async preview(raw: unknown): Promise<unknown> {
    if (this.runner && !this.runner.state.endedAt) throw new Error("Stop the active run before taking a setup preview");
    const session = new WindowsDesktopSession();
    try {
      await session.bind(DesktopWindowSchema.parse(raw), 10000); await session.focus();
      await new Promise(resolve => setTimeout(resolve, 300));
      const observation = await session.observe();
      return { ...observation, png: undefined, image: `data:image/png;base64,${observation.png.toString("base64")}` };
    } finally { await session.close(); }
  }
  async windows(): Promise<DesktopWindow[]> {
    const session = new WindowsDesktopSession();
    try { return await session.listWindows(); } finally { await session.close(); }
  }
  async profiles(): Promise<unknown[]> {
    await mkdir(this.profilesDir, { recursive: true });
    const profiles = new Map<string, unknown>();
    const roots = [path.join(this.repoRoot, "profiles", "desktop"), this.profilesDir];
    for (const root of roots) for (const filename of await readdir(root)) {
      if (!filename.endsWith(".json")) continue;
      try { const profile = DesktopProfileSchema.parse(JSON.parse(await readFile(path.join(root, filename), "utf8"))); profiles.set(profile.name, profile); }
      catch { /* Invalid user files are excluded; saving through the API validates first. */ }
    }
    return [...profiles.values()];
  }
  async save(raw: unknown): Promise<unknown> {
    const profile = DesktopProfileSchema.parse(raw);
    await mkdir(this.profilesDir, { recursive: true });
    const filename = createHash("sha256").update(profile.name).digest("hex") + ".json";
    const temp = path.join(this.profilesDir, randomUUID() + ".tmp");
    await writeFile(temp, JSON.stringify(profile, null, 2));
    await rename(temp, path.join(this.profilesDir, filename));
    return profile;
  }
  async start(raw: unknown): Promise<DesktopRunState> {
    if (this.starting || (this.runner && !this.runner.state.endedAt)) throw new Error("A desktop run is already active");
    const request = DesktopRunRequestSchema.parse(raw);
    this.starting = true;
    let policy: DesktopPolicy | undefined;
    try {
      if (request.profile.mode === "local") {
        if (!request.profile.learnedBehaviorId) throw new Error("Select a behavior trained with Learn locally");
        const behavior = await new DesktopBehaviorStore(this.repoRoot).get(request.profile.learnedBehaviorId);
        if (behavior.processName !== request.target.processName) throw new Error("Local behavior belongs to a different application");
        policy = await LocalDesktopPolicy.create(this.repoRoot, behavior, request.profile.localOptions);
        request.profile.goal = behavior.goal; request.profile.name = behavior.name;
        request.profile.intervalMs = Math.max(350, request.profile.intervalMs);
        await pruneLocalRunArtifacts(this.repoRoot, 4);
      }
      if (request.profile.mode === "feedback") {
        if (!request.profile.learnedBehaviorId) throw new Error("Select a saved learned behavior for intelligent playback");
        const store = new DesktopBehaviorStore(this.repoRoot); const behavior = await store.get(request.profile.learnedBehaviorId);
        if (behavior.processName !== request.target.processName) throw new Error("Learned behavior belongs to a different application");
        const model = createVisualModel();
        policy = new LearnedDesktopPolicy(model, behavior, await store.references(behavior), request.profile.learnedOptions);
        request.profile.goal = behavior.goal;
        request.profile.name = behavior.name;
      }
      const session = new WindowsDesktopSession();
      const runner = new DesktopRunner(session, new FsArtifactStore({ rootDir: path.join(this.repoRoot, "artifacts") }), request.target, request.profile, policy);
      this.runner = runner;
      void runner.start().catch(() => undefined); // Runner persists and exposes failures in its state.
      return runner.state;
    } catch (error) { await policy?.close?.(); throw error; }
    finally { this.starting = false; }
  }
  async control(action: string): Promise<DesktopRunState | null> {
    if (!this.runner) return null;
    if (action === "pause") await this.runner.pause();
    else if (action === "resume") await this.runner.resume();
    else if (action === "stop") await this.runner.stop();
    else throw new Error("Unknown desktop control");
    return this.runner.state;
  }
  async close(): Promise<void> { await this.runner?.stop(); }
}
