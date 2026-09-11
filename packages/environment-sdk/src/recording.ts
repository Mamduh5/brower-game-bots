import { z } from "zod";
import { DesktopActionSchema, DesktopWindowSchema } from "./desktop.js";

export const ControlHotkeySchema = z.enum(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F9", "F10", "F11"]);
export const DesktopHotkeysSchema = z.object({ record: ControlHotkeySchema.default("F6"), bot: ControlHotkeySchema.default("F7"), stopRecording: ControlHotkeySchema.default("F9") }).strict().superRefine((keys, ctx) => {
  if (new Set(Object.values(keys)).size !== 3) ctx.addIssue({ code: "custom", message: "Recording, bot and stop-recording hotkeys must be different. F8 is reserved for emergency stop." });
});
export type DesktopHotkeys = z.infer<typeof DesktopHotkeysSchema>;
export const RecordingOptionsSchema = z.object({ target: DesktopWindowSchema, delayMs: z.number().int().min(0).max(60000).default(3000), maxDurationMs: z.number().int().min(1000).max(120000).default(120000) }).strict();
export type RecordingOptions = z.infer<typeof RecordingOptionsSchema>;
export const RecordedEventSchema = z.object({ atMs: z.number().int().min(0).max(120000), action: DesktopActionSchema }).strict();
export type RecordedEvent = z.infer<typeof RecordedEventSchema>;
export const RecordingStateSchema = z.object({
  status: z.enum(["idle", "armed", "countdown", "recording", "paused", "stopped", "failed"]),
  reason: z.string(), elapsedMs: z.number().nonnegative(), countdownMs: z.number().nonnegative(),
  eventCount: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  target: DesktopWindowSchema.nullable(), hotkeys: DesktopHotkeysSchema.nullable(),
  botArmed: z.boolean(), botActive: z.boolean(), commands: z.array(z.enum(["bot", "emergency"])),
  events: z.array(RecordedEventSchema).max(2100).optional()
});
export type RecordingState = z.infer<typeof RecordingStateSchema>;
export interface DesktopRecorder {
  configureHotkeys(keys: DesktopHotkeys): Promise<RecordingState>;
  recordingCommand(command: "prepare" | "start" | "pause" | "resume" | "stop" | "discard", options?: RecordingOptions): Promise<RecordingState>;
  recordingState(includeEvents?: boolean): Promise<RecordingState>;
  setBotControl(armed: boolean, active: boolean): Promise<void>;
  close(): Promise<void>;
}
