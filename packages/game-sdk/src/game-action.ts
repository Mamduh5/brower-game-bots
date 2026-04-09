import { z } from "zod";

import { JsonObjectSchema } from "@game-bots/contracts";

export const GameActionSpecSchema = z.object({
  actionId: z.string().min(1),
  description: z.string().min(1),
  paramsExample: JsonObjectSchema.optional()
});
export type GameActionSpec = z.infer<typeof GameActionSpecSchema>;

export const GameActionRequestSchema = z.object({
  actionId: z.string().min(1),
  params: JsonObjectSchema.optional()
});
export type GameActionRequest = z.infer<typeof GameActionRequestSchema>;
