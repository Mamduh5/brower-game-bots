import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SqliteRunRepository } from "@game-bots/persistence-sqlite";

import { createContainer } from "../src/bootstrap/container.js";
import { runTester } from "../src/commands/run-tester.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("runTester integration", () => {
  it(
    "executes one tester scenario, persists a finding, and writes a JSON report artifact",
    async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "game-bots-tester-"));
      const sqlitePath = path.join(tempDir, "run.sqlite");
      const artifactsPath = path.join(tempDir, "artifacts");
      const overrideConfigPath = path.join(tempDir, "integration.override.yaml");

      await writeFile(
        overrideConfigPath,
        [
          "logging:",
          "  level: debug",
          "persistence:",
          "  sqlite:",
          `    filename: ${JSON.stringify(sqlitePath)}`,
          "artifacts:",
          `  rootDir: ${JSON.stringify(artifactsPath)}`
        ].join("\n"),
        "utf8"
      );

      const container = await createContainer({
        cwd: repoRoot,
        configPaths: [path.join(repoRoot, "config", "default.yaml"), overrideConfigPath]
      });

      const result = await runTester(container);
      const repository = new SqliteRunRepository({
        filename: sqlitePath
      });
      const storedRun = await repository.getRun(result.run.runId);
      const storedEvents = await repository.listEvents(result.run.runId);
      const storedFindings = await repository.getFindings(result.run.runId);
      const clickabilityFinding = result.findings.find((finding) => finding.metadata?.clickProbe);
      const stateExpectationFinding = result.findings.find((finding) => finding.metadata?.stateExpectation);
      const resetFinding = result.findings.find((finding) => finding.title.includes("Reset control missing"));

      expect(storedRun?.phase).toBe("completed");
      expect(result.findings.length).toBeGreaterThanOrEqual(2);
      expect(resetFinding).toBeDefined();
      expect(resetFinding?.category).toBe("ui");
      expect(resetFinding?.severity).toBe("medium");
      expect(resetFinding?.evidence.length).toBeGreaterThanOrEqual(2);
      expect(resetFinding?.metadata?.sources).toBeDefined();
      expect(clickabilityFinding).toBeDefined();
      expect(clickabilityFinding?.title).toContain("smaller clickable region");
      expect(clickabilityFinding?.metadata?.clickProbe?.successRatio).toBeLessThan(
        clickabilityFinding?.metadata?.clickProbe?.minimumSuccessRatio as number
      );
      expect(clickabilityFinding?.evidence.length).toBeGreaterThanOrEqual(2);
      expect(clickabilityFinding?.metadata?.sources).toBeDefined();
      expect(stateExpectationFinding).toBeDefined();
      expect(stateExpectationFinding?.category).toBe("functional");
      expect(stateExpectationFinding?.metadata?.stateExpectation?.failedEffects.length).toBeGreaterThanOrEqual(1);
      expect(
        stateExpectationFinding?.evidence.some((entry) => entry.label === "state-expectation")
      ).toBe(true);
      expect(stateExpectationFinding?.metadata?.sources).toBeDefined();
      expect(storedFindings.length).toBe(result.findings.length);
      expect(storedEvents.some((event) => event.type === "evaluation.finding_created")).toBe(true);
      expect(
        storedEvents.some(
          (event) => event.type === "observation.captured" && event.observationKind === "click-probe"
        )
      ).toBe(true);
      expect(
        storedEvents.some(
          (event) => event.type === "observation.captured" && event.observationKind === "state-expectation"
        )
      ).toBe(true);
      expect(
        storedEvents.some(
          (event) => event.type === "report.generated" && event.reportId === result.report.reportId
        )
      ).toBe(true);
      expect(result.report.summary.totalFindings).toBe(result.findings.length);
      expect(result.report.summary.categoryCounts.ui).toBeGreaterThanOrEqual(2);
      expect(result.report.summary.categoryCounts.functional).toBeGreaterThanOrEqual(1);
      expect(result.report.summary.severityCounts.medium).toBeGreaterThanOrEqual(1);
      expect(result.report.summary.highFindings).toBeGreaterThanOrEqual(1);
      expect(result.report.summary.topFindings.length).toBeGreaterThan(0);
      expect(result.report.summary.artifactCounts.screenshot).toBeGreaterThanOrEqual(1);

      const reportArtifact = result.artifacts.find((artifact) => artifact.kind === "report");
      expect(reportArtifact).toBeDefined();
      await expect(access(path.join(artifactsPath, reportArtifact!.relativePath))).resolves.toBeUndefined();
      const reportJson = JSON.parse(await readFile(path.join(artifactsPath, reportArtifact!.relativePath), "utf8"));
      const reportClickabilityFinding = reportJson.findings.find(
        (finding: { metadata?: { clickProbe?: unknown } }) => Boolean(finding.metadata?.clickProbe)
      );
      expect(reportClickabilityFinding).toBeDefined();
      expect(reportClickabilityFinding.metadata.clickProbe.successRatio).toBeLessThan(
        reportClickabilityFinding.metadata.clickProbe.minimumSuccessRatio
      );
      expect(reportClickabilityFinding.evidence.length).toBeGreaterThanOrEqual(2);
      expect(reportClickabilityFinding.reproSteps.length).toBeGreaterThan(0);
      const reportStateExpectationFinding = reportJson.findings.find(
        (finding: { metadata?: { stateExpectation?: unknown } }) => Boolean(finding.metadata?.stateExpectation)
      );
      expect(reportStateExpectationFinding).toBeDefined();
      expect(reportStateExpectationFinding.metadata.stateExpectation.failedEffects.length).toBeGreaterThanOrEqual(1);
      expect(reportJson.summary.topFindings.length).toBeGreaterThan(0);
    },
    30_000
  );
});
