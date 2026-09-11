import { z } from "zod";
import { DesktopPointSchema } from "@game-bots/environment-sdk";
import { TeachingIdSchema } from "./teaching.js";

export const LocalRegionSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(.05).max(1), height: z.number().min(.05).max(1) }).strict()
  .refine(r => r.x + r.width <= 1.00001 && r.y + r.height <= 1.00001, "Region must fit the image");
export type LocalRegion = z.infer<typeof LocalRegionSchema>;
export const LocalRunOptionsSchema = z.object({
  finishOnSuccess: z.boolean().default(false),
  minConfidence: z.number().min(.5).max(.95).default(.62),
  maxNoProgress: z.number().int().min(2).max(12).default(6),
  maxRecoveries: z.number().int().min(0).max(4).default(2),
  maxActionMs: z.number().int().min(100).max(1000).default(800)
}).strict();
export type LocalRunOptions = z.infer<typeof LocalRunOptionsSchema>;
export const LocalTrainSchema = z.object({
  behaviorId: TeachingIdSchema, demonstrationId: TeachingIdSchema.optional(),
  outcome: z.enum(["success", "failure", "uncertain"]).optional(),
  recovery: z.boolean().default(false),
  successFrame: z.number().int().nonnegative().optional(),
  target: z.object({ frameId: z.number().int().nonnegative(), point: DesktopPointSchema, size: z.number().min(.05).max(.3).default(.12) }).strict().optional(),
  region: LocalRegionSchema.optional()
}).strict();
export type LocalTrainRequest = z.infer<typeof LocalTrainSchema>;
