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
          findingId: "finding-2",
          runId: "run-1",
          title: "App crashed",
          summary: "Renderer stopped responding.",
          severity: "critical",
          category: "crash",
          confidence: 0.95,
          evidence: [{ label: "trace", artifactId: "artifact-1" }],
          reproSteps: [
            {
              order: 1,
              instruction: "Open crash screen",
              expected: "Screen remains responsive",
              actual: "Renderer stopped responding"
            }
          ],
          createdAt: "2026-04-09T00:05:00.000Z"
        },
        {
          findingId: "finding-1",
          runId: "run-1",
          title: "Button hitbox mismatch",
          summary: "Only center click is working.",
          severity: "medium",
          category: "ui",
          confidence: 0.92,
          evidence: [{ label: "screenshot", artifactId: "artifact-2" }],
          reproSteps: [
            {
              order: 1,
              instruction: "Click the visible button corners.",
              expected: "Each corner click activates action",
              actual: "Only center click activates action"
            }
          ],
          createdAt: "2026-04-09T00:04:00.000Z"
        }
      ],
      evidence: [
        {
          artifactId: "artifact-2",
          runId: "run-1",
          kind: "screenshot",
          relativePath: "captures/a.png",
          contentType: "image/png",
          createdAt: "2026-04-09T00:04:30.000Z"
        }
      ],
      completedAt: new Date("2026-04-09T00:06:00.000Z")
    });

    expect(report.summary.totalFindings).toBe(2);
    expect(report.summary.criticalFindings).toBe(1);
    expect(report.summary.highFindings).toBe(1);
    expect(report.summary.severityCounts.critical).toBe(1);
    expect(report.summary.categoryCounts.crash).toBe(1);
    expect(report.summary.artifactCounts.screenshot).toBe(1);
    expect(report.summary.outcome).toBe("failed");
    expect(report.findings[0]?.severity).toBe("critical");
    expect(report.summary.topFindings[0]?.title).toBe("App crashed");
    expect(report.summary.topFindings[0]?.expected).toBe("Screen remains responsive");
    expect(report.summary.topFindings[0]?.actual).toBe("Renderer stopped responding");
  });
});
