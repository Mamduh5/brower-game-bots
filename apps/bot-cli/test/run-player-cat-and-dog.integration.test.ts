import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SqliteRunRepository } from "@game-bots/persistence-sqlite";

import { createContainer } from "../src/bootstrap/container.js";
import { runPlayerCatAndDog } from "../src/commands/run-player-cat-and-dog.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("runPlayerCatAndDog integration", () => {
  it(
    "retries attempts, varies strategy, stops on win, and persists summary artifacts",
    async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "game-bots-player-cat-dog-"));
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

        const result = await runPlayerCatAndDog(container, {
          maxAttempts: 3,
          stopOnWin: true,
          strategyMode: "baseline",
          maxStepsPerAttempt: 8
        });
        const repository = new SqliteRunRepository({
          filename: sqlitePath
        });
        const storedRun = await repository.getRun(result.run.runId);
        const storedEvents = await repository.listEvents(result.run.runId);

        expect(storedRun?.phase).toBe("completed");
        expect(storedRun?.gameId).toBe("cat-and-dog-web");
        expect(result.attempts).toHaveLength(2);
        expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(["LOSS", "WIN"]);
        expect(result.attempts[0]?.strategySelectionReason).toBe("initial-candidate");
        expect(result.attempts[1]?.strategySelectionReason).toBe("anchor-exact-replay");
        expect(result.attempts[1]?.strategySelectionDetails.topReferenceAttemptNumber).toBe(1);
        expect(result.attempts[1]?.strategySelectionDetails.selectionMode).toBe("exact-replay");
        expect(result.attempts[1]?.strategySelectionDetails.changedKnob).toBe("none");
        expect(result.attempts[0]?.diagnostics.gameplayEnteredObserved).toBe(true);
        expect(result.attempts[0]?.diagnostics.playerTurnReadyObserved).toBe(true);
        expect(result.attempts[0]?.diagnostics.shotsFired).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.shotResolutionsObserved).toBe(1);
        expect(result.attempts[0]?.diagnostics.damageDealt).toBe(28);
        expect(result.attempts[0]?.diagnostics.damageTaken).toBe(100);
        expect(result.attempts[0]?.diagnostics.hpTrackingAvailable).toBe(true);
        expect(result.attempts[0]?.diagnostics.damageTrackingConfirmed).toBe(true);
        expect(result.attempts[0]?.diagnostics.progressSignalSource).toBe("hp");
        expect(result.attempts[0]?.diagnostics.combatHintsObserved).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.instructionalHintsObserved).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.visionAvailableObserved).toBe(true);
        expect(result.attempts[0]?.diagnostics.visionChangeSignals).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.lastHintCategory).toBe("combat-result");
        expect(result.attempts[0]?.diagnostics.elapsedMs).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.totalWaitMs).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.resolutionWaitMs).toBeGreaterThanOrEqual(0);
        expect(result.attempts[0]?.diagnostics.waitHeavyRatio).toBeGreaterThan(0);
        expect(result.attempts[0]?.diagnostics.nonWaitOverheadMs).toBeGreaterThanOrEqual(0);
        expect(result.attempts[0]?.diagnostics.observationCount).toBeGreaterThan(0);
        expect(result.attempts[1]?.diagnostics.endOverlayObserved).toBe(true);
        expect(result.attempts[1]?.diagnostics.damageDealt).toBe(100);
        expect(result.attempts[1]?.diagnostics.damageTaken).toBe(22);
        expect(result.attempts[1]?.diagnostics.hpTrackingAvailable).toBe(true);
        expect(result.attempts[1]?.diagnostics.visionStrongChangeSignals).toBeGreaterThan(0);
        expect(result.attempts[1]?.diagnostics.turnStatusHintsObserved).toBeGreaterThanOrEqual(0);
        expect(result.attempts[1]?.diagnostics.stepBudgetReached).toBe(false);
        expect(result.attempts[1]?.diagnostics.elapsedMs).toBeGreaterThan(0);
        expect(result.attempts[1]?.diagnostics.totalWaitMs).toBeGreaterThan(0);
        expect(result.attempts[1]?.assessment).toBe("won-round");
        expect(result.attempts[0]?.strategy.turnResolutionWaitMs).toBe(result.attempts[1]?.strategy.turnResolutionWaitMs);
        expect(result.attempts[1]?.strategySelectionDetails.topReferenceDistance).toBe(0);
        expect(
          storedEvents.some(
            (event) => event.type === "report.generated" && event.reportId === result.report.reportId
          )
        ).toBe(true);

        const attemptStartEvents = storedEvents.filter(
          (event) => event.type === "observation.captured" && event.observationKind === "attempt.started"
        );
        const attemptCompletedEvents = storedEvents.filter(
          (event) => event.type === "observation.captured" && event.observationKind === "attempt.completed"
        );
        expect(attemptStartEvents).toHaveLength(2);
        expect(attemptCompletedEvents).toHaveLength(2);
        expect(attemptCompletedEvents[0]?.payload.outcome).toBe("LOSS");
        expect(attemptCompletedEvents[1]?.payload.outcome).toBe("WIN");
        expect(attemptCompletedEvents[0]?.payload.diagnostics.shotsFired).toBeGreaterThan(0);
        expect(attemptCompletedEvents[0]?.payload.diagnostics.damageDealt).toBe(28);
        expect(attemptCompletedEvents[1]?.payload.diagnostics.damageDealt).toBe(100);
        expect(attemptCompletedEvents[0]?.payload.diagnostics.hpTrackingAvailable).toBe(true);
        expect(attemptCompletedEvents[0]?.payload.diagnostics.progressSignalSource).toBe("hp");
        expect(attemptCompletedEvents[0]?.payload.diagnostics.visionChangeSignals).toBeGreaterThan(0);
        expect(attemptCompletedEvents[0]?.payload.diagnostics.lastHintCategory).toBe("combat-result");
        expect(attemptCompletedEvents[0]?.payload.diagnostics.elapsedMs).toBeGreaterThan(0);
        expect(attemptCompletedEvents[0]?.payload.diagnostics.totalWaitMs).toBeGreaterThan(0);
        expect(attemptCompletedEvents[1]?.payload.diagnostics.endOverlayObserved).toBe(true);
        expect(attemptCompletedEvents[1]?.payload.assessment).toBe("won-round");
        expect(attemptCompletedEvents[1]?.payload.strategySelectionDetails.topReferenceAttemptNumber).toBe(1);

        const screenshotPaths = result.artifacts
          .filter((artifact) => artifact.kind === "screenshot")
          .map((artifact) => artifact.relativePath);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("attempt-01/10-pre-gameplay-screen"))).toBe(true);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("attempt-01/20-post-entry-screen"))).toBe(true);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("attempt-01/30-end-state-screen"))).toBe(true);
        expect(screenshotPaths.some((relativePath) => relativePath.includes("attempt-02/40-outcome-screen"))).toBe(true);

        const summaryArtifact = result.artifacts.find((artifact) => artifact.relativePath.includes("02-player-attempt-summary.json"));
        expect(summaryArtifact).toBeDefined();
        await expect(access(path.join(artifactsPath, summaryArtifact!.relativePath))).resolves.toBeUndefined();
        const summaryJson = JSON.parse(await readFile(path.join(artifactsPath, summaryArtifact!.relativePath), "utf8"));
        expect(summaryJson.summary.hadWin).toBe(true);
        expect(summaryJson.summary.winningAttemptNumber).toBe(2);
        expect(summaryJson.summary.winningAttemptStrategy.angleDirection).toBe("right");
        expect(summaryJson.summary.unknownAttempts).toBe(0);
        expect(summaryJson.summary.terminalAttempts).toBe(2);
        expect(summaryJson.summary.mostProgressiveAttemptNumber).toBe(2);
        expect(summaryJson.summary.mostProgressiveAttemptAssessment).toBe("won-round");
        expect(summaryJson.summary.mostProgressiveAttemptScore).toBeGreaterThan(500);
        expect(summaryJson.summary.winningStrategy).toBeUndefined();
        expect(summaryJson.attempts[0].strategySelectionReason).toBe("initial-candidate");
        expect(summaryJson.attempts[1].strategySelectionReason).toBe("anchor-exact-replay");
        expect(summaryJson.attempts[1].strategySelectionDetails.topReferenceAttemptNumber).toBe(1);
        expect(summaryJson.attempts[1].strategySelectionDetails.selectionMode).toBe("exact-replay");
        expect(summaryJson.attempts[0].diagnostics.shotsFired).toBeGreaterThan(0);
        expect(summaryJson.attempts[0].assessment).toBe("loss-with-damage");
        expect(summaryJson.attempts[0].diagnostics.damageDealt).toBe(28);
        expect(summaryJson.attempts[0].diagnostics.hpTrackingAvailable).toBe(true);
        expect(summaryJson.attempts[0].diagnostics.progressSignalSource).toBe("hp");
        expect(summaryJson.attempts[0].diagnostics.instructionalHintsObserved).toBeGreaterThan(0);
        expect(summaryJson.attempts[0].diagnostics.visionChangeSignals).toBeGreaterThan(0);
        expect(summaryJson.attempts[0].diagnostics.lastHintCategory).toBe("combat-result");
        expect(summaryJson.attempts[0].diagnostics.elapsedMs).toBeGreaterThan(0);
        expect(summaryJson.attempts[0].diagnostics.waitHeavyRatio).toBeGreaterThan(0);
        expect(summaryJson.attempts[0].diagnostics.nonWaitOverheadMs).toBeGreaterThanOrEqual(0);
        expect(summaryJson.attempts[1].diagnostics.damageDealt).toBe(100);
        expect(summaryJson.attempts[1].finalState.visionImpactCategory).not.toBe("none");
        expect(summaryJson.strategyInsights.rankedAttemptVariants[0].attemptNumber).toBe(2);
        expect(summaryJson.strategyInsights.rankedAttemptVariants[0].score).toBeGreaterThan(
          summaryJson.strategyInsights.rankedAttemptVariants[1].score
        );
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
    45_000
  );

  it(
    "terminates a visibly stalled CPU turn loop early instead of spending the whole step budget",
    async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "game-bots-player-cat-dog-stall-"));
      const sqlitePath = path.join(tempDir, "run.sqlite");
      const artifactsPath = path.join(tempDir, "artifacts");
      const overrideConfigPath = path.join(tempDir, "integration.override.yaml");
      const fixturePath = path.join(repoRoot, "games", "cat-and-dog-web", "fixtures", "cat-and-dog-fixture.html");
      const fixtureHtml = await readFile(fixturePath, "utf8");
      const stalledFixtureHtml = fixtureHtml.replace(
        "window.setTimeout(resolveShotOutcome, 150);",
        [
          "window.setTimeout(() => {",
          "  state.turnCount += 1;",
          "  state.playerTurnReady = false;",
          "  matchNote.textContent = 'CPU Dog sizes up the next shot.';",
          "  canvasHint.textContent = 'CPU Dog sizes up the next shot.';",
          "  syncUi();",
          "}, 150);"
        ].join("\n")
      );

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
        response.end(stalledFixtureHtml);
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind local stalled fixture server.");
      }

      process.env.GAME_BOTS_CAT_AND_DOG_URL = `http://127.0.0.1:${address.port}/play/desktop/`;

      try {
        const container = await createContainer({
          cwd: repoRoot,
          configPaths: [path.join(repoRoot, "config", "default.yaml"), overrideConfigPath]
        });

        const result = await runPlayerCatAndDog(container, {
          maxAttempts: 1,
          stopOnWin: true,
          strategyMode: "baseline",
          maxStepsPerAttempt: 12
        });

        expect(result.attempts).toHaveLength(1);
        expect(result.attempts[0]?.outcome).toBe("UNKNOWN");
        expect(result.attempts[0]?.assessment).toBe("stalled-loop");
        expect(result.attempts[0]?.note).toContain("stalled");
        expect(result.attempts[0]?.diagnostics.stalledLoopDetected).toBe(true);
        expect(result.attempts[0]?.diagnostics.stalledLoopReason).toBe("unresolved-shot-loop");
        expect(result.attempts[0]?.diagnostics.stepBudgetReached).toBe(false);
        expect(result.attempts[0]?.diagnostics.maxUnchangedObservationCycles).toBeGreaterThanOrEqual(2);
        expect(result.attempts[0]?.diagnostics.observationCount).toBeGreaterThan(0);
        expect(result.attempts[0]?.finalState.endVisible).toBe(false);
        expect(result.attempts[0]?.finalState.endTitleText).toBeNull();
        expect(result.attempts[0]?.finalState.endSubtitleText).toBeNull();
        expect(result.attempts[0]?.finalState.cpuSetupVisible).toBe(false);
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
    45_000
  );
});
