import { randomUUID } from "node:crypto";

import type { ArtifactRef, Finding, RunReport, RunRecord } from "@game-bots/contracts";

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function sortArtifacts(artifacts: readonly ArtifactRef[]): ArtifactRef[] {
  return [...artifacts].sort((left, right) => {
    const kindDelta = left.kind.localeCompare(right.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }

    return left.relativePath.localeCompare(right.relativePath);
  });
}

function summarizeTopFindings(findings: readonly Finding[]) {
  return findings.slice(0, 5).map((finding) => {
    const expectationStep = finding.reproSteps.find(
      (step) => typeof step.expected === "string" || typeof step.actual === "string"
    );

    return {
      findingId: finding.findingId,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      ...(expectationStep?.expected ? { expected: expectationStep.expected } : {}),
      ...(expectationStep?.actual ? { actual: expectationStep.actual } : {})
    };
  });
}

export class ReportBuilder {
  build(input: {
    run: RunRecord;
    findings: readonly Finding[];
    evidence: readonly ArtifactRef[];
    completedAt: Date;
  }): RunReport {
    const outcome = input.run.status === "active" ? "completed" : input.run.status;
    const sortedFindings = sortFindings(input.findings);
    const sortedArtifacts = sortArtifacts(input.evidence);

    return {
      reportId: randomUUID(),
      runId: input.run.runId,
      findings: sortedFindings,
      evidence: sortedArtifacts,
      generatedAt: input.completedAt.toISOString(),
      summary: {
        totalFindings: sortedFindings.length,
        criticalFindings: sortedFindings.filter((finding) => finding.severity === "critical").length,
        highFindings: sortedFindings.filter(
          (finding) => finding.severity === "critical" || finding.severity === "high"
        ).length,
        severityCounts: countBy(sortedFindings.map((finding) => finding.severity)),
        categoryCounts: countBy(sortedFindings.map((finding) => finding.category)),
        artifactCounts: countBy(sortedArtifacts.map((artifact) => artifact.kind)),
        topFindings: summarizeTopFindings(sortedFindings),
        completedAt: input.completedAt.toISOString(),
        outcome
      }
    };
  }
}
