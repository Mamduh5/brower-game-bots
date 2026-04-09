import { z } from "zod";

import { ArtifactRefSchema } from "./artifacts.js";
import { FindingCategorySchema, FindingSchema, FindingSeveritySchema } from "./findings.js";
import { FindingIdSchema, ReportIdSchema, RunIdSchema } from "./ids.js";

export const ReportTopFindingSchema = z.object({
  findingId: FindingIdSchema,
  title: z.string().min(1),
  severity: FindingSeveritySchema,
  category: FindingCategorySchema,
  expected: z.string().optional(),
  actual: z.string().optional()
});
export type ReportTopFinding = z.infer<typeof ReportTopFindingSchema>;

export const RunReportSummarySchema = z.object({
  totalFindings: z.number().int().nonnegative(),
  criticalFindings: z.number().int().nonnegative(),
  highFindings: z.number().int().nonnegative(),
  severityCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  categoryCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  artifactCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  topFindings: z.array(ReportTopFindingSchema).default([]),
  completedAt: z.string().datetime(),
  outcome: z.enum(["completed", "failed", "cancelled"])
});
export type RunReportSummary = z.infer<typeof RunReportSummarySchema>;

export const RunReportSchema = z.object({
  reportId: ReportIdSchema,
  runId: RunIdSchema,
  summary: RunReportSummarySchema,
  findings: z.array(FindingSchema),
  evidence: z.array(ArtifactRefSchema),
  generatedAt: z.string().datetime()
});
export type RunReport = z.infer<typeof RunReportSchema>;
