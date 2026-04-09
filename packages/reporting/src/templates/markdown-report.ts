import type { RunReport } from "@game-bots/contracts";

export function toMarkdownReport(report: RunReport): string {
  const findings = report.findings
    .map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.summary}`)
    .join("\n");

  return [
    `# Run Report ${report.runId}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Total Findings: ${report.summary.totalFindings}`,
    "",
    "## Findings",
    findings || "- none"
  ].join("\n");
}
