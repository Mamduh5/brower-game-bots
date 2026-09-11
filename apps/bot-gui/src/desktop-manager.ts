import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DesktopRunner, type DesktopRunState } from "@game-bots/agent-player";
import { WindowsDesktopSession } from "@game-bots/environment-windows";
import { DesktopProfileSchema, DesktopRunRequestSchema } from "@game-bots/game-sdk";
import { FsArtifactStore } from "@game-bots/artifact-store-fs";
import { DesktopWindowSchema, type DesktopWindow } from "@game-bots/environment-sdk";

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
    if (request.profile.mode === "feedback") throw new Error("No visual reasoning provider is installed. Use automation or integrate a DesktopPolicy.");
    this.starting = true;
    try {
      const session = new WindowsDesktopSession();
      const runner = new DesktopRunner(session, new FsArtifactStore({ rootDir: path.join(this.repoRoot, "artifacts") }), request.target, request.profile);
      this.runner = runner;
      void runner.start().catch(() => undefined); // Runner persists and exposes failures in its state.
      return runner.state;
    } finally { this.starting = false; }
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
