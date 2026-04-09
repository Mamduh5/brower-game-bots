import { describe, expect, it } from "vitest";

import type { RunEvent, RunRecord } from "@game-bots/contracts";

import { ClickabilityEvaluator } from "../src/evaluators/clickability-evaluator.js";

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

describe("ClickabilityEvaluator", () => {
  it("creates a finding when click success ratio is below the scenario threshold", async () => {
    const evaluator = new ClickabilityEvaluator();
    const event: RunEvent = {
      eventId: "event-click-probe",
      runId: run.runId,
      sequence: 4,
      timestamp: "2026-04-09T00:00:04.000Z",
      type: "observation.captured",
      observationKind: "click-probe",
      summary: "Clickable samples: 1/9 within the visible control bounds.",
      payload: {
        probeId: "help-probe-hitbox",
        description: "Probe the visible help control.",
        surfaceSelector: "#help-probe-shell",
        activationSelector: "#help-probe-trigger",
        minimumSuccessRatio: 0.5,
        successRatio: 1 / 9,
        totalSamples: 9,
        successfulSamples: 1,
        sampleResults: [
          {
            label: "center",
            clickStatus: "succeeded"
          },
          {
            label: "top-left",
            clickStatus: "missed"
          }
        ]
      }
    };

    const findings = await evaluator.onEvent(event, {
      run,
      clock: {
        now: () => new Date("2026-04-09T00:00:05.000Z")
      }
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("ui");
    expect(findings[0]?.summary).toContain("1/9 sampled points");
    expect(findings[0]?.metadata?.clickProbe?.probeId).toBe("help-probe-hitbox");
  });
});
