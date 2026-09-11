import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DesktopHotkeysSchema, RecordingOptionsSchema, type DesktopHotkeys, type DesktopRecorder, type RecordingState } from "@game-bots/environment-sdk";
import { DesktopRunRequestSchema, recordingToProfile, type DesktopProfile } from "@game-bots/game-sdk";
import type { DesktopRunState } from "@game-bots/agent-player";
import { WindowsDesktopSession } from "@game-bots/environment-windows";

interface BotControls { state(): DesktopRunState | null; start(raw: unknown): Promise<DesktopRunState>; control(action: string): Promise<DesktopRunState | null> }
const activeRecording = (state: RecordingState | null): boolean => !!state && ["armed", "countdown", "recording", "paused"].includes(state.status);
/** Serializes user/hotkey commands so watching and controlling can never race. */
export class DesktopRecordingManager {
  private recorder: DesktopRecorder | undefined;
  private nativeState: RecordingState | null = null;
  private draft: DesktopProfile | null = null;
  private error: string | null = null;
  private armedBot: ReturnType<typeof DesktopRunRequestSchema.parse> | null = null;
  private keys: DesktopHotkeys | undefined;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private convertedGeneration = -1;
  constructor(private readonly root: string, private readonly bots: BotControls, private readonly createRecorder: () => DesktopRecorder = () => new WindowsDesktopSession()) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation); this.queue = task.catch(() => undefined); return task;
  }
  snapshot() { return { recording: this.nativeState, draft: this.draft, draftId: this.convertedGeneration, error: this.error, botArmed: this.armedBot !== null, armedProfileName: this.armedBot?.profile.name ?? null }; }
  private botActive(): boolean { const run = this.bots.state(); return !!run && !run.endedAt; }
  async settings(): Promise<DesktopHotkeys> {
    if (!this.keys) {
      try { this.keys = DesktopHotkeysSchema.parse(JSON.parse(await readFile(path.join(this.root, "data/desktop-hotkeys.json"), "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Saved desktop hotkeys are invalid; replace them using Apply shortcuts"); this.keys = DesktopHotkeysSchema.parse({}); }
    }
    return this.keys;
  }
  private async service(): Promise<DesktopRecorder> {
    if (this.closed) throw new Error("Desktop recording service is closed");
    if (!this.recorder) {
      const keys = await this.settings(); const recorder = this.createRecorder();
      try { this.nativeState = await recorder.configureHotkeys(keys); this.recorder = recorder; this.pollLater(); }
      catch (error) { await recorder.close(); throw error; }
    }
    return this.recorder;
  }
  async saveSettings(raw: unknown): Promise<DesktopHotkeys> {
    return this.serial(async () => {
      if (activeRecording(this.nativeState) || this.botActive() || this.armedBot) throw new Error("Stop recording and stop/disarm the bot before changing shortcuts");
      const keys = DesktopHotkeysSchema.parse(raw);
      const recorder = this.recorder ?? this.createRecorder();
      try { this.nativeState = await recorder.configureHotkeys(keys); }
      catch (error) { await recorder.close(); this.recorder = undefined; throw error; }
      this.recorder = recorder; this.keys = keys; this.pollLater();
      const folder = path.join(this.root, "data"); await mkdir(folder, { recursive: true });
      const temporary = path.join(folder, `hotkeys-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(keys, null, 2)); await rename(temporary, path.join(folder, "desktop-hotkeys.json"));
      this.error = null; return keys;
    });
  }
  async record(raw: Record<string, unknown>) {
    return this.serial(async () => {
      if (this.botActive() || this.armedBot || activeRecording(this.nativeState)) throw new Error("Stop the active recording or stop/disarm the bot first");
      const { startMethod, ...input } = raw;
      if (!["button", "delay", "hotkey"].includes(String(startMethod))) throw new Error("Choose a recording start method");
      const options = RecordingOptionsSchema.parse(input);
      if (startMethod === "button") options.delayMs = 0;
      const recorder = await this.service(); this.error = null; this.draft = null; this.generation++;
      this.nativeState = await recorder.recordingCommand("prepare", options);
      if (startMethod !== "hotkey") this.nativeState = await recorder.recordingCommand("start");
      return this.snapshot();
    });
  }
  async recordingControl(action: "pause" | "resume" | "stop" | "discard") {
    return this.serial(async () => {
      if (!this.recorder && (action === "stop" || action === "discard")) return this.snapshot();
      if (action === "stop" && !activeRecording(this.nativeState)) return this.snapshot();
      const recorder = await this.service(); this.nativeState = await recorder.recordingCommand(action);
      if (action === "discard") { this.draft = null; this.error = null; this.generation++; this.convertedGeneration = this.generation; }
      else if (action === "stop") this.convert(this.nativeState);
      return this.snapshot();
    });
  }
  private convert(state: RecordingState): void {
    if (!state.events || this.convertedGeneration === this.generation) return;
    this.convertedGeneration = this.generation;
    try { this.draft = recordingToProfile(state.events); this.error = null; }
    catch (error) { this.draft = null; this.error = error instanceof Error ? error.message : String(error); }
  }
  private validateReserved(profile: DesktopProfile, keys: DesktopHotkeys): void {
    const reserved = new Set<string>(Object.values(keys));
    for (const action of [...profile.actions.filter(a => a.enabled !== false), ...profile.skills.flatMap(s => s.actions)]) {
      const used = action.kind === "hold" ? action.keys : action.kind === "key-down" || action.kind === "key-up" ? [action.key] : [];
      if (used.some(k => reserved.has(k))) throw new Error("Configuration uses a registered control hotkey as gameplay input. Change the shortcut or edit the action first.");
    }
  }
  async startBot(raw: Record<string, unknown>) {
    return this.serial(async () => {
      if (activeRecording(this.nativeState) || this.botActive() || this.armedBot) throw new Error("Stop recording or stop/disarm the current bot first");
      const { startMethod = "delay", ...input } = raw;
      if (!["button", "delay", "hotkey"].includes(String(startMethod))) throw new Error("Choose a bot start method");
      const request = DesktopRunRequestSchema.parse(input);
      if (request.profile.mode !== "automation") throw new Error("This GUI supports human-configured playback only");
      if (raw.startMethod === undefined && !this.recorder) { await this.bots.start(request); return { ...this.snapshot(), run: this.bots.state() }; }
      const recorder = await this.service(); this.validateReserved(request.profile, await this.settings());
      if (startMethod === "button") request.profile.startDelayMs = 0;
      this.error = null;
      if (startMethod === "hotkey") { await recorder.setBotControl(true, false); this.armedBot = request; }
      else {
        await recorder.setBotControl(false, true);
        try { await this.bots.start(request); } catch (error) { await recorder.setBotControl(false, false); throw error; }
      }
      return { ...this.snapshot(), run: this.bots.state() };
    });
  }
  async botControl(action: "pause" | "resume" | "stop") {
    return this.serial(async () => {
      if (action === "stop") { this.armedBot = null; if (this.recorder) await this.recorder.setBotControl(false, this.botActive()); }
      const run = await this.bots.control(action);
      if (action === "stop" && this.recorder) await this.recorder.setBotControl(false, false);
      return { run, ...this.snapshot() };
    });
  }
  private pollLater(): void {
    if (this.timer || this.closed || !this.recorder) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.serial(() => this.poll()).finally(() => this.pollLater()); }, 150);
  }
  private async poll(): Promise<void> {
    if (!this.recorder || this.closed) return;
    try {
      const state = await this.recorder.recordingState(); this.nativeState = state;
      if (this.generation > 0 && ["stopped", "failed"].includes(state.status) && this.convertedGeneration !== this.generation) {
        const completed = await this.recorder.recordingState(true);
        state.commands.push(...completed.commands); this.convert(completed);
      }
      if (state.commands.includes("emergency")) {
        this.armedBot = null; await this.bots.control("stop"); await this.recorder.setBotControl(false, false);
      } else if (state.commands.includes("bot") && this.armedBot && !this.botActive() && !activeRecording(state)) {
        const request = this.armedBot; this.armedBot = null;
        await this.recorder.setBotControl(false, true);
        try { await this.bots.start(request); } catch (error) { await this.recorder.setBotControl(false, false); throw error; }
      }
      if (state.botActive && !this.botActive()) await this.recorder.setBotControl(false, false);
      if (state.status === "failed") this.error = state.reason;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error); this.armedBot = null;
      await this.bots.control("stop").catch(() => undefined);
      await this.recorder.close().catch(() => undefined); this.recorder = undefined;
    }
  }
  async close(): Promise<void> {
    this.closed = true; if (this.timer) clearTimeout(this.timer);
    await this.serial(async () => { this.armedBot = null; try { await this.bots.control("stop"); } finally { await this.recorder?.close(); this.recorder = undefined; } });
  }
}
