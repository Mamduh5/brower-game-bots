import { z } from "zod";

import { JsonValueSchema, ScenarioIdSchema } from "@game-bots/contracts";
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

export const StateExpectationOperatorSchema = z.enum(["changes", "equals"]);
export type StateExpectationOperator = z.infer<typeof StateExpectationOperatorSchema>;

export const SemanticStateEffectExpectationSchema = z
  .object({
    effectId: z.string().min(1),
    description: z.string().min(1),
    path: z.string().min(1),
    operator: StateExpectationOperatorSchema,
    expectedValue: JsonValueSchema.optional()
  })
  .superRefine((value, context) => {
    if (value.operator === "equals" && value.expectedValue === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expectedValue is required when operator is 'equals'.",
        path: ["expectedValue"]
      });
    }
  });
export type SemanticStateEffectExpectation = z.infer<typeof SemanticStateEffectExpectationSchema>;

export const ScenarioActionExpectationSchema = z.object({
  actionId: z.string().min(1),
  description: z.string().min(1),
  effects: z.array(SemanticStateEffectExpectationSchema).min(1)
});
export type ScenarioActionExpectation = z.infer<typeof ScenarioActionExpectationSchema>;

export const TestScenarioSchema = z.object({
  scenarioId: ScenarioIdSchema,
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  clickProbes: z.array(ClickProbeTargetSchema).default([]),
  actionExpectations: z.array(ScenarioActionExpectationSchema).default([])
});
export type TestScenario = z.infer<typeof TestScenarioSchema>;
