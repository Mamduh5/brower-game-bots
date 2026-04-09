import { describe, expect, it } from "vitest";

import { ReportBuilder } from "../src/application/report-builder.js";

describe("ReportBuilder", () => {
  it("aggregates summary counts from findings", () => {
    const builder = new ReportBuilder();
    const report = builder.build({
      run: {
        runId: "run-1",
        agentKind: "tester",
        gameId: "wordle-web",
        environmentId: "playwright-browser",
        phase: "reporting",
        status: "failed",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:05:00.000Z",
        config: {}
      },
      findings: [
        {
          findingId: "finding-1",
          runId: "run-1",
          title: "App crashed",
          summary: "Renderer stopped responding.",
          severity: "critical",
          category: "crash",
          confidence: 0.95,
          evidence: [{ label: "trace", artifactId: "artifact-1" }],
          reproSteps: [],
          createdAt: "2026-04-09T00:05:00.000Z"
        }
      ],
      evidence: [],
      completedAt: new Date("2026-04-09T00:06:00.000Z")
    });

    expect(report.summary.totalFindings).toBe(1);
    expect(report.summary.criticalFindings).toBe(1);
    expect(report.summary.outcome).toBe("failed");
  });
});
