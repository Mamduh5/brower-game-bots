import { z } from "zod";

import { JsonObjectSchema } from "@game-bots/contracts";

export const GameSnapshotSchema = z.object({
  title: z.string().min(1),
  isTerminal: z.boolean().default(false),
  semanticState: JsonObjectSchema,
  metrics: JsonObjectSchema.default({})
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;
