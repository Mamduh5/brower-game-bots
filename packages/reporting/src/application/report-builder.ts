import { randomUUID } from "node:crypto";

import type { ArtifactRef, Finding, RunReport, RunRecord } from "@game-bots/contracts";

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

export class ReportBuilder {
  build(input: {
    run: RunRecord;
    findings: readonly Finding[];
    evidence: readonly ArtifactRef[];
    completedAt: Date;
  }): RunReport {
    const outcome = input.run.status === "active" ? "completed" : input.run.status;

    return {
      reportId: randomUUID(),
      runId: input.run.runId,
      findings: [...input.findings],
      evidence: [...input.evidence],
      generatedAt: input.completedAt.toISOString(),
      summary: {
        totalFindings: input.findings.length,
        criticalFindings: input.findings.filter((finding) => finding.severity === "critical").length,
        severityCounts: countBy(input.findings.map((finding) => finding.severity)),
        categoryCounts: countBy(input.findings.map((finding) => finding.category)),
        completedAt: input.completedAt.toISOString(),
        outcome
      }
    };
  }
}
