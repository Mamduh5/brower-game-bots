import { z } from "zod";

import { ArtifactRefSchema } from "./artifacts.js";
import { FindingSchema } from "./findings.js";
import { ReportIdSchema, RunIdSchema } from "./ids.js";

export const RunReportSummarySchema = z.object({
  totalFindings: z.number().int().nonnegative(),
  criticalFindings: z.number().int().nonnegative(),
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
