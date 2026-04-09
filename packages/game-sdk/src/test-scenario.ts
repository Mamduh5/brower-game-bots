import { z } from "zod";

import { ScenarioIdSchema } from "@game-bots/contracts";

export const TestScenarioSchema = z.object({
  scenarioId: ScenarioIdSchema,
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([])
});
export type TestScenario = z.infer<typeof TestScenarioSchema>;
