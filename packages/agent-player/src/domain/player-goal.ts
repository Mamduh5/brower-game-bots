import { z } from "zod";

export const PlayerGoalSchema = z.object({
  mode: z.string().min(1),
  constraints: z.record(z.string(), z.string()).default({})
});
export type PlayerGoal = z.infer<typeof PlayerGoalSchema>;
