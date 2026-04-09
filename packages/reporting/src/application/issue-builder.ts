import type { RunReport } from "@game-bots/contracts";

import type { IssueCandidate } from "../domain/finding-candidate.js";

export class IssueBuilder {
  build(report: RunReport): readonly IssueCandidate[] {
    return report.findings.map((finding) => ({
      title: finding.title,
      body: finding.summary,
      findingIds: [finding.findingId]
    }));
  }
}
