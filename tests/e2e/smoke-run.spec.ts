import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

test("cli smoke run completes one player cycle", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "game-bots-e2e-"));
  const sqlitePath = path.join(tempDir, "run.sqlite");
  const artifactsPath = path.join(tempDir, "artifacts");
  const overrideConfigPath = path.join(tempDir, "e2e.override.yaml");

  await writeFile(
    overrideConfigPath,
    [
      "logging:",
      "  level: info",
      "persistence:",
      "  sqlite:",
      `    filename: ${JSON.stringify(sqlitePath)}`,
      "artifacts:",
      `  rootDir: ${JSON.stringify(artifactsPath)}`
    ].join("\n"),
    "utf8"
  );

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(repoRoot, "apps", "bot-cli", "dist", "main.js"), "run-player"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        GAME_BOTS_CONFIG_PATHS: [
          path.join(repoRoot, "config", "default.yaml"),
          overrideConfigPath
        ].join(path.delimiter)
      }
    }
  );

  const artifactRuns = await readdir(artifactsPath);

  expect(stderr).toBe("");
  expect(stdout).toContain("Completed player run");
  expect(artifactRuns.length).toBeGreaterThan(0);
});
