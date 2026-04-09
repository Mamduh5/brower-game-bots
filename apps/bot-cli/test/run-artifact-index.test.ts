import { describe, expect, it } from "vitest";

import type { ArtifactRef, Finding, RunEvent, RunRecord } from "@game-bots/contracts";

import { buildArtifactCaptureName, buildArtifactIndex } from "../src/commands/run-artifact-index.js";

describe("buildArtifactCaptureName", () => {
  it("creates deterministic step-prefixed names", () => {
    expect(buildArtifactCaptureName(4, "Post Action Screen")).toBe("04-post-action-screen");
  });
});

describe("buildArtifactIndex", () => {
  it("produces a debug-friendly artifact/finding index", () => {
    const run: RunRecord = {
      runId: "run-1",
      agentKind: "tester",
      gameId: "wordle-web",
      scenarioId: "smoke",
      environmentId: "playwright-browser",
      phase: "reporting",
      status: "active",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:01:00.000Z",
      config: {}
    };

    const artifacts: ArtifactRef[] = [
      {
        artifactId: "artifact-dom",
        runId: run.runId,
        kind: "dom-snapshot",
        relativePath: "run-1/dom/01-post-action.html",
        contentType: "text/html",
        createdAt: "2026-04-09T00:00:20.000Z"
      },
      {
        artifactId: "artifact-screen",
        runId: run.runId,
        kind: "screenshot",
        relativePath: "run-1/screenshots/01-post-action.png",
        contentType: "image/png",
        createdAt: "2026-04-09T00:00:19.000Z"
      }
    ];

    const finding: Finding = {
      findingId: "finding-1",
      runId: run.runId,
      title: "Expected state not reached",
      summary: "The submit action did not disable the submit button.",
      severity: "high",
      category: "functional",
      confidence: 0.95,
      evidence: [
        {
          eventId: "event-2",
          label: "post-action-state"
        },
        {
          artifactId: "artifact-dom",
          label: "artifact-primary-dom-snapshot",
          detail: "run-1/dom/01-post-action.html"
        }
      ],
      reproSteps: [
        {
          order: 1,
          instruction: "Submit one guess.",
          expected: "Submit button becomes disabled.",
          actual: "Submit button remains enabled."
        }
      ],
      createdAt: "2026-04-09T00:00:30.000Z"
    };

    const events: RunEvent[] = [
      {
        eventId: "event-1",
        runId: run.runId,
        sequence: 1,
        timestamp: "2026-04-09T00:00:10.000Z",
        type: "observation.captured",
        observationKind: "opening",
        payload: {}
      },
      {
        eventId: "event-2",
        runId: run.runId,
        sequence: 2,
        timestamp: "2026-04-09T00:00:20.000Z",
        type: "observation.captured",
        observationKind: "post-action",
        payload: {}
      }
    ];

    const index = buildArtifactIndex({
      run,
      artifacts,
      findings: [finding],
      events
    });

    expect(index.summary.findingCount).toBe(1);
    expect(index.summary.artifactCount).toBe(2);
    expect(index.summary.eventTypeCounts["observation.captured"]).toBe(2);
    expect(index.findings[0].linkedArtifacts[0].artifactId).toBe("artifact-dom");
    expect(index.artifacts[0].fileName).toBe("01-post-action.html");
  });
});
