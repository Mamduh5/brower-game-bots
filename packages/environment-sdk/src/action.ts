import { z } from "zod";

import { JsonObjectSchema } from "@game-bots/contracts";

const SelectorTargetSchema = z.object({
  selector: z.string().min(1)
});

const ClickActionSchema = z.object({
  kind: z.literal("click"),
  target: SelectorTargetSchema
});

const TypeActionSchema = z.object({
  kind: z.literal("type"),
  target: SelectorTargetSchema,
  text: z.string()
});

const KeyPressActionSchema = z.object({
  kind: z.literal("keypress"),
  key: z.string().min(1)
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
