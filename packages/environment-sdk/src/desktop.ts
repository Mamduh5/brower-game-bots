import { z } from "zod";

export const DesktopKeySchema = z.string().regex(/^(Key[A-Z]|Digit[0-9]|Space|Enter|Tab|Escape|Backspace|Delete|Arrow(Up|Down|Left|Right)|Shift|Control|Alt|Home|End|PageUp|PageDown|F([1-7]|9|1[0-2]))$/);
export const DesktopButtonSchema = z.enum(["left", "right", "middle"]);
export const DesktopPointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const duration = z.number().int().min(0).max(5000);
export const DesktopActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), point: DesktopPointSchema }).strict(),
  z.object({ kind: z.literal("relative-move"), dx: z.number().int().min(-1000).max(1000), dy: z.number().int().min(-1000).max(1000) }).strict(),
  z.object({ kind: z.literal("click"), point: DesktopPointSchema, button: DesktopButtonSchema, durationMs: duration.default(50) }).strict(),
  z.object({ kind: z.literal("button-down"), button: DesktopButtonSchema }).strict(),
  z.object({ kind: z.literal("button-up"), button: DesktopButtonSchema }).strict(),
  z.object({ kind: z.literal("drag"), from: DesktopPointSchema, to: DesktopPointSchema, button: DesktopButtonSchema, durationMs: duration.default(300) }).strict(),
  z.object({ kind: z.literal("scroll"), ticks: z.number().int().min(-20).max(20), axis: z.enum(["vertical", "horizontal"]).default("vertical") }).strict(),
  z.object({ kind: z.literal("key-down"), key: DesktopKeySchema }).strict(),
  z.object({ kind: z.literal("key-up"), key: DesktopKeySchema }).strict(),
  z.object({ kind: z.literal("hold"), keys: z.array(DesktopKeySchema).max(8).default([]), buttons: z.array(DesktopButtonSchema).max(3).default([]), durationMs: duration }).strict(),
  z.object({ kind: z.literal("wait"), durationMs: duration }).strict(),
  z.object({ kind: z.literal("release-all") }).strict()
]);
export type DesktopAction = z.infer<typeof DesktopActionSchema>;

export const DesktopWindowSchema = z.object({
  handle: z.string().regex(/^\d+$/), pid: z.number().int().positive(), processStartedAt: z.string(),
  title: z.string(), processName: z.string(),
  bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }),
  dpi: z.number().positive()
});
export type DesktopWindow = z.infer<typeof DesktopWindowSchema>;
export interface DesktopObservation {
  capturedAt: string;
  window: DesktopWindow;
  /** Changes on position, size, or DPI changes; input rejects stale geometry. */
  geometry: string;
  png: Buffer;
  sha256: string;
}
export interface DesktopHealth { armed: boolean; reason: string | null; heldKeys: string[]; heldButtons: string[] }
export interface DesktopSession {
  listWindows(): Promise<DesktopWindow[]>;
  bind(target: DesktopWindow, maxDurationMs: number): Promise<void>;
  focus(): Promise<void>;
  observe(): Promise<DesktopObservation>;
  execute(action: DesktopAction, geometry: string, signal: AbortSignal): Promise<void>;
  health(): Promise<DesktopHealth>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  releaseAll(): Promise<void>;
  close(): Promise<void>;
}
