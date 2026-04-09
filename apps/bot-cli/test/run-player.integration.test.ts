import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SqliteRunRepository } from "@game-bots/persistence-sqlite";

import { createContainer } from "../src/bootstrap/container.js";
import { runPlayer } from "../src/commands/run-player.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("runPlayer integration", () => {
  it(
    "executes one real browser-game cycle and persists events and artifacts",
    async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "game-bots-player-"));
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

      const result = await runPlayer(container);
      const repository = new SqliteRunRepository({
        filename: sqlitePath
      });

      const storedRun = await repository.getRun(result.run.runId);
      const storedEvents = await repository.listEvents(result.run.runId);

      expect(storedRun?.phase).toBe("completed");
      expect(storedEvents.map((event) => event.type)).toEqual([
        "run.created",
        "run.phase_changed",
        "run.phase_changed",
        "run.phase_changed",
        "run.phase_changed",
        "observation.captured",
        "action.executed",
        "action.executed",
        "artifact.stored",
        "observation.captured",
        "run.phase_changed",
        "run.phase_changed",
        "run.phase_changed",
        "run.completed"
      ]);
      expect(result.artifacts).toHaveLength(1);
      await expect(access(path.join(artifactsPath, result.artifacts[0].relativePath))).resolves.toBeUndefined();
    },
    30_000
  );
});
