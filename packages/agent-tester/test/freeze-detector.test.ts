import { describe, expect, it } from "vitest";

import type { RunEvent, RunRecord } from "@game-bots/contracts";

import { FreezeDetector } from "../src/evaluators/freeze-detector.js";

const run: RunRecord = {
  runId: "run-1",
  agentKind: "tester",
  gameId: "wordle-web",
  environmentId: "playwright-browser",
  scenarioId: "smoke",
  phase: "evaluating",
  status: "active",
  createdAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z",
  config: {}
};

function buildObservationEvent(eventId: string, observationKind: string, status: string): RunEvent {
  return {
    eventId,
    runId: run.runId,
    sequence: 1,
    timestamp: "2026-04-09T00:00:01.000Z",
    type: "observation.captured",
    observationKind,
    summary: "Semantic snapshot captured.",
    payload: {
      gameSnapshotTitle: "Wordle",
      gameSnapshotTerminal: false,
      gameSemanticState: {
        status,
        boardRows: [""]
      },
      gameMetrics: {
        rowCount: 1
      }
    }
  };
}

describe("FreezeDetector", () => {
  it("creates a finding when semantic state does not change after a successful action", async () => {
    const detector = new FreezeDetector();
    const clock = {
      now: () => new Date("2026-04-09T00:00:04.000Z")
    };

    await detector.onEvent(buildObservationEvent("opening", "opening", "ready"), { run, clock });
    await detector.onEvent(
      {
        eventId: "action-1",
        runId: run.runId,
        sequence: 2,
        timestamp: "2026-04-09T00:00:02.000Z",
        type: "action.executed",
        actionKind: "click",
        status: "succeeded",
        payload: {
          action: "click",
          targetSelector: "#submit-guess"
        }
      },
      { run, clock }
    );

    const findings = await detector.onEvent(buildObservationEvent("closing", "post-action", "ready"), {
      run,
      clock
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("functional");
    expect(findings[0]?.summary).toContain("semantic game snapshot remained unchanged");
  });
});
