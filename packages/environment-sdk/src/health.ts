import { z } from "zod";

import { JsonObjectSchema } from "@game-bots/contracts";

export const EnvironmentHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "failed"]),
  checkedAt: z.string().datetime(),
  detail: z.string().optional(),
  signals: JsonObjectSchema.default({})
});
export type EnvironmentHealth = z.infer<typeof EnvironmentHealthSchema>;
