import { z } from "zod";

import { ScenarioIdSchema } from "@game-bots/contracts";
import { ClickProbeSamplePointSchema } from "@game-bots/environment-sdk";

export const ClickProbeTargetSchema = z.object({
  probeId: z.string().min(1),
  description: z.string().min(1),
  surfaceSelector: z.string().min(1),
  activationSelector: z.string().min(1).optional(),
  minimumSuccessRatio: z.number().min(0).max(1).default(0.6),
  samplePoints: z.array(ClickProbeSamplePointSchema).min(1).optional()
});
export type ClickProbeTarget = z.infer<typeof ClickProbeTargetSchema>;

export const TestScenarioSchema = z.object({
  scenarioId: ScenarioIdSchema,
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  clickProbes: z.array(ClickProbeTargetSchema).default([])
});
export type TestScenario = z.infer<typeof TestScenarioSchema>;
