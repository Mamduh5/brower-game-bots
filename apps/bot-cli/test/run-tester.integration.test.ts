import { access, mkdtemp, writeFile } from "node:fs/promises";
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

      expect(storedRun?.phase).toBe("completed");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.title).toContain("Reset control missing");
      expect(storedEvents.some((event) => event.type === "evaluation.finding_created")).toBe(true);
      expect(
        storedEvents.some(
          (event) => event.type === "report.generated" && event.reportId === result.report.reportId
        )
      ).toBe(true);
      expect(result.report.summary.totalFindings).toBe(1);

      const reportArtifact = result.artifacts.find((artifact) => artifact.kind === "report");
      expect(reportArtifact).toBeDefined();
      await expect(access(path.join(artifactsPath, reportArtifact!.relativePath))).resolves.toBeUndefined();
    },
    30_000
  );
});
