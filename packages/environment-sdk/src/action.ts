import { z } from "zod";

import { JsonObjectSchema } from "@game-bots/contracts";

const SelectorTargetSchema = z.object({
  selector: z.string().min(1)
});

const ClickActionSchema = z.object({
  kind: z.literal("click"),
  target: SelectorTargetSchema
});

const ClickIfVisibleActionSchema = z.object({
  kind: z.literal("click-if-visible"),
  target: SelectorTargetSchema
});

const CoordinatePointSchema = z.object({
  x: z.number(),
  y: z.number()
});

const MouseClickActionSchema = z.object({
  kind: z.literal("mouse-click"),
  point: CoordinatePointSchema
});

const MouseDragActionSchema = z.object({
  kind: z.literal("mouse-drag"),
  from: CoordinatePointSchema,
  to: CoordinatePointSchema,
  steps: z.number().int().positive().max(80).optional()
});

const TypeActionSchema = z.object({
  kind: z.literal("type"),
  target: SelectorTargetSchema,
  text: z.string()
});

const KeyPressActionSchema = z.object({
  kind: z.literal("keypress"),
  key: z.string().min(1),
  repeat: z.number().int().positive().max(120).optional()
});

const NavigateActionSchema = z.object({
  kind: z.literal("navigate"),
  url: z.string().url()
});

const WaitActionSchema = z.object({
  kind: z.literal("wait"),
  durationMs: z.number().int().nonnegative()
});

const ScrollActionSchema = z.object({
  kind: z.literal("scroll"),
  deltaY: z.number()
});

export const EnvironmentActionSchema = z.discriminatedUnion("kind", [
  ClickActionSchema,
  ClickIfVisibleActionSchema,
  MouseClickActionSchema,
  MouseDragActionSchema,
  TypeActionSchema,
  KeyPressActionSchema,
  NavigateActionSchema,
  WaitActionSchema,
  ScrollActionSchema
]);
export type EnvironmentAction = z.infer<typeof EnvironmentActionSchema>;

export const ActionResultSchema = z.object({
  status: z.enum(["succeeded", "failed", "skipped"]),
  completedAt: z.string().datetime(),
  detail: z.string().optional(),
  payload: JsonObjectSchema.default({})
});
export type ActionResult = z.infer<typeof ActionResultSchema>;
