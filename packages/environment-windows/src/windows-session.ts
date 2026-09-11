import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { DesktopActionSchema, DesktopWindowSchema, type DesktopAction, type DesktopHealth, type DesktopObservation, type DesktopSession, type DesktopWindow } from "@game-bots/environment-sdk";
import { DesktopHotkeysSchema, RecordingOptionsSchema, RecordingStateSchema, type DesktopHotkeys, type DesktopRecorder, type RecordingOptions, type RecordingState } from "@game-bots/environment-sdk";

const HealthSchema = z.object({ armed: z.boolean(), reason: z.string().nullable(), heldKeys: z.array(z.string()), heldButtons: z.array(z.string()) });
const CaptureSchema = z.object({ window: DesktopWindowSchema, geometry: z.string(), png: z.string(), capturedAt: z.string() });

/** One persistent helper owns actual input and independently watches focus/F8/leases. */
export class WindowsDesktopSession implements DesktopSession, DesktopRecorder {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private readonly heartbeat: NodeJS.Timeout;
  private sequence = 0;
  private closed = false;
  private stderr = "";
  private actionActive = false;
  private currentAction: AbortController | undefined;

  constructor(helperPath = fileURLToPath(new URL("../bin/DesktopBridge.exe", import.meta.url))) {
    if (process.platform !== "win32") throw new Error("Desktop control requires Windows 10/11.");
    // A detached Windows process survives controller termination long enough to release input.
    // It remains supervised through stdin EOF, heartbeat, and parent PID checks.
    this.child = spawn(helperPath, [String(process.pid)], { stdio: "pipe", windowsHide: true, detached: true });
    this.child.stderr.on("data", (data: Buffer) => { this.stderr = (this.stderr + data.toString()).slice(-4000); });
    createInterface({ input: this.child.stdout }).on("line", line => {
      try {
        const message = z.object({ id: z.number(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }).parse(JSON.parse(line));
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id); clearTimeout(request.timer);
        if (message.ok) request.resolve(message.result); else request.reject(new Error(message.error ?? "Native helper rejected command"));
      } catch { this.fail(new Error("Invalid native helper response")); }
    });
    this.child.on("error", error => this.fail(new Error(`Native helper could not start; run pnpm desktop:setup. ${error.message}`)));
    this.child.on("exit", () => this.fail(new Error(`Native helper exited. ${this.stderr}`)));
    this.child.stdin.on("error", error => this.fail(error));
    this.heartbeat = setInterval(() => { void this.request({ op: "heartbeat" }).catch(() => undefined); }, 500);
  }

  private fail(error: Error): void {
    this.closed = true; clearInterval(this.heartbeat); this.currentAction?.abort(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.child.stdin.end();
  }

  private request(command: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Native session is closed"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Native helper command timed out; heartbeat stopped for cleanup")), 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n");
    });
  }

  async listWindows(): Promise<DesktopWindow[]> { return z.array(DesktopWindowSchema).parse(await this.request({ op: "list" })); }
  async bind(target: DesktopWindow, maxDurationMs: number, maxHoldMs = 5500): Promise<void> { await this.request({ op: "bind", target: DesktopWindowSchema.parse(target), maxDurationMs, maxHoldMs }); }
  async configureHotkeys(hotkeys: DesktopHotkeys): Promise<RecordingState> { return RecordingStateSchema.parse(await this.request({ op: "recorder-hotkeys", hotkeys: DesktopHotkeysSchema.parse(hotkeys) })); }
  async recordingCommand(command: "prepare" | "start" | "pause" | "resume" | "stop" | "discard", options?: RecordingOptions): Promise<RecordingState> {
    return RecordingStateSchema.parse(await this.request({ op: `recorder-${command}`, ...(options ? RecordingOptionsSchema.parse(options) : {}), includeEvents: command === "stop" }));
  }
  async recordingState(includeEvents = false): Promise<RecordingState> { return RecordingStateSchema.parse(await this.request({ op: "recorder-state", includeEvents })); }
  async recordingFrames() {
    const frames = z.array(CaptureSchema.extend({ atMs: z.number(), eventCount: z.number(), heldKeys: z.array(z.string()), heldButtons: z.array(z.string()) })).max(8).parse(await this.request({ op: "recorder-frames" }));
    return frames.map(frame => { const png = Buffer.from(frame.png, "base64"); return { ...frame, png, sha256: createHash("sha256").update(png).digest("hex") }; });
  }
  async setBotControl(armed: boolean, active: boolean): Promise<void> { await this.request({ op: "recorder-bot", armed, active }); }
  async focus(): Promise<void> { await this.request({ op: "focus" }); }
  async observe(): Promise<DesktopObservation> {
    const capture = CaptureSchema.parse(await this.request({ op: "observe" }));
    const png = Buffer.from(capture.png, "base64");
    return { ...capture, png, sha256: createHash("sha256").update(png).digest("hex") };
  }
  async health(): Promise<DesktopHealth> { return HealthSchema.parse(await this.request({ op: "health" })); }
  async pause(): Promise<void> { this.currentAction?.abort(new Error("Paused")); await this.request({ op: "pause" }); }
  async resume(): Promise<void> { await this.request({ op: "resume" }); }
  async releaseAll(): Promise<void> {
    await this.request({ op: "release" });
    const health = await this.health();
    if (health.heldKeys.length || health.heldButtons.length) throw new Error(health.reason ?? "Held input cleanup failed");
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.currentAction?.abort(new Error("Stopped"));
    clearInterval(this.heartbeat);
    try { await this.releaseAll(); await this.request({ op: "close" }); }
    finally { this.closed = true; this.child.stdin.end(); }
  }

  async execute(raw: DesktopAction, geometry: string, signal: AbortSignal): Promise<void> {
    const action = DesktopActionSchema.parse(raw);
    if (this.actionActive) throw new Error("Concurrent desktop actions are not allowed; use held state for overlapping input");
    this.actionActive = true;
    const local = new AbortController(); this.currentAction = local;
    const combined = AbortSignal.any([signal, local.signal]);
    const wait = async (ms: number): Promise<void> => {
      combined.throwIfAborted();
      for (let remaining = ms; remaining > 0; remaining -= 100) {
        await delay(Math.min(100, remaining), undefined, { signal: combined });
        if (ms >= 100) { const health = await this.health(); if (!health.armed) throw new Error(health.reason ?? "Native input disarmed"); }
      }
    };
    const primitive = async (input: Record<string, unknown>): Promise<void> => {
      await wait(10); await this.request({ op: "input", geometry, ...input }); combined.throwIfAborted();
    };
    try {
      combined.throwIfAborted();
      if ((action.kind === "click" || action.kind === "drag") && (await this.health()).heldButtons.includes(action.button)) throw new Error("Release the button before clicking or dragging with it");
      switch (action.kind) {
        case "wait": await wait(action.durationMs); break;
        case "release-all": await this.releaseAll(); break;
        case "click":
          await primitive({ kind: "move", point: action.point });
          await primitive({ kind: "button-down", button: action.button });
          await wait(action.durationMs);
          await primitive({ kind: "button-up", button: action.button });
          break;
        case "hold": {
          const before = await this.health();
          const keys = [...new Set(action.keys)].filter(k => !before.heldKeys.includes(k));
          const buttons = [...new Set(action.buttons)].filter(b => !before.heldButtons.includes(b));
          for (const key of keys) await primitive({ kind: "key-down", key });
          for (const button of buttons) await primitive({ kind: "button-down", button });
          await wait(action.durationMs);
          for (const button of buttons.reverse()) await primitive({ kind: "button-up", button });
          for (const key of keys.reverse()) await primitive({ kind: "key-up", key });
          break;
        }
        case "drag":
          await primitive({ kind: "move", point: action.from });
          await primitive({ kind: "button-down", button: action.button });
          for (let step = 1; step <= 20; step++) {
            await wait(action.durationMs / 20);
            await primitive({ kind: "move", point: { x: action.from.x + (action.to.x - action.from.x) * step / 20, y: action.from.y + (action.to.y - action.from.y) * step / 20 } });
          }
          await primitive({ kind: "button-up", button: action.button });
          break;
        default: await primitive(action);
      }
      combined.throwIfAborted();
    } catch (error) {
      await this.releaseAll();
      throw error;
    } finally { this.actionActive = false; this.currentAction = undefined; }
  }
}
