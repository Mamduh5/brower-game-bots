import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SqliteRunRepository } from "@game-bots/persistence-sqlite";

import { createContainer } from "../src/bootstrap/container.js";
import { runTester } from "../src/commands/run-tester.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("runTester integration (cat-and-dog)", () => {
  it(
    "executes one smoke run against the cat-and-dog fixture route and persists report artifacts",
    async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "game-bots-tester-cat-dog-"));
      const sqlitePath = path.join(tempDir, "run.sqlite");
      const artifactsPath = path.join(tempDir, "artifacts");
      const overrideConfigPath = path.join(tempDir, "integration.override.yaml");
      const fixturePath = path.join(repoRoot, "games", "cat-and-dog-web", "fixtures", "cat-and-dog-fixture.html");
      const fixtureHtml = await readFile(fixturePath, "utf8");

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

      const previousUrl = process.env.GAME_BOTS_CAT_AND_DOG_URL;
      const server = createServer((_request, response) => {
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(fixtureHtml);
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind local fixture server.");
      }

      process.env.GAME_BOTS_CAT_AND_DOG_URL = `http://127.0.0.1:${address.port}/play/desktop/`;

      try {
        const container = await createContainer({
          cwd: repoRoot,
          configPaths: [path.join(repoRoot, "config", "default.yaml"), overrideConfigPath]
        });

        const result = await runTester(container, {
          gameId: "cat-and-dog-web",
          profileId: "cat-and-dog-web.tester.smoke",
          scenarioId: "smoke"
        });
        const repository = new SqliteRunRepository({
          filename: sqlitePath
        });
        const storedRun = await repository.getRun(result.run.runId);
        const storedEvents = await repository.listEvents(result.run.runId);

        expect(storedRun?.phase).toBe("completed");
        expect(storedRun?.gameId).toBe("cat-and-dog-web");
        const openingObservation = storedEvents.find(
          (event) => event.type === "observation.captured" && event.observationKind === "opening"
        );
        const postActionObservations = storedEvents.filter(
          (event) => event.type === "observation.captured" && event.observationKind === "post-action"
        );
        const closingObservation = postActionObservations.at(-1);

        expect(openingObservation).toBeDefined();
        expect(postActionObservations.length).toBeGreaterThanOrEqual(2);
        expect(closingObservation).toBeDefined();
        expect(storedEvents.filter((event) => event.type === "action.executed").length).toBeGreaterThanOrEqual(2);
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

        expect(openingObservation?.payload.gameSemanticState).toMatchObject({
          status: "landing",
          gameplayEntered: false
        });
        expect(closingObservation?.payload.gameSemanticState).toMatchObject({
          status: "gameplay",
          gameplayEntered: true,
          hasGameplayHud: true,
          hasGameplayControls: true,
          aimDirection: "left",
          gameplayInputApplied: true
        });

        const screenshotPaths = result.artifacts
          .filter((artifact) => artifact.kind === "screenshot")
          .map((artifact) => artifact.relativePath);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("10-pre-action-screen"))).toBe(true);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("20-post-entry-screen"))).toBe(true);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("30-post-gameplay-action-screen"))).toBe(true);

        const reportArtifact = result.artifacts.find((artifact) => artifact.kind === "report");
        expect(reportArtifact).toBeDefined();
        await expect(access(path.join(artifactsPath, reportArtifact!.relativePath))).resolves.toBeUndefined();
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });

        if (previousUrl === undefined) {
          delete process.env.GAME_BOTS_CAT_AND_DOG_URL;
        } else {
          process.env.GAME_BOTS_CAT_AND_DOG_URL = previousUrl;
        }
      }
    },
    30_000
  );
});
