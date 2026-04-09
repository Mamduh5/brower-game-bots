import { z } from "zod";

import { EvidenceRefSchema } from "./artifacts.js";
import { FindingIdSchema, RunIdSchema, ScenarioIdSchema } from "./ids.js";
import { JsonObjectSchema } from "./json.js";

export const FindingSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const FindingCategorySchema = z.enum([
  "crash",
  "freeze",
  "functional",
  "ui",
  "ux",
  "performance",
  "other"
]);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const ReproStepSchema = z.object({
  order: z.number().int().nonnegative(),
  instruction: z.string().min(1),
  expected: z.string().optional(),
  actual: z.string().optional()
});
export type ReproStep = z.infer<typeof ReproStepSchema>;

export const FindingSchema = z.object({
  findingId: FindingIdSchema,
  runId: RunIdSchema,
  scenarioId: ScenarioIdSchema.optional(),
  title: z.string().min(1),
  summary: z.string().min(1),
  severity: FindingSeveritySchema,
  category: FindingCategorySchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceRefSchema).min(1),
  reproSteps: z.array(ReproStepSchema),
  metadata: JsonObjectSchema.optional(),
  createdAt: z.string().datetime()
});
export type Finding = z.infer<typeof FindingSchema>;
