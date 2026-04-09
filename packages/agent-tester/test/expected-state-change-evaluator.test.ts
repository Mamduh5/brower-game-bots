import { describe, expect, it } from "vitest";

import type { RunEvent, RunRecord } from "@game-bots/contracts";

import { ExpectedStateChangeEvaluator } from "../src/evaluators/expected-state-change-evaluator.js";

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

describe("ExpectedStateChangeEvaluator", () => {
  it("creates a finding when an expected semantic effect does not occur", async () => {
    const evaluator = new ExpectedStateChangeEvaluator();
    const event: RunEvent = {
      eventId: "event-state-expectation",
      runId: run.runId,
      sequence: 6,
      timestamp: "2026-04-09T00:00:06.000Z",
      type: "observation.captured",
      observationKind: "state-expectation",
      summary: "Submit guess should update semantic state.",
      payload: {
        actionId: "submit-guess",
        description: "Submit guess should update semantic state.",
        effects: [
          {
            effectId: "submit-locks",
            description: "Submit button becomes disabled.",
            path: "submitDisabled",
            operator: "equals",
            expectedValue: true
          }
        ],
        preState: {
          submitDisabled: false,
          status: "ready"
        },
        postState: {
          submitDisabled: false,
          status: "guess-submitted"
        },
        preObservationEventId: "opening",
        postObservationEventId: "closing",
        actionEventIds: ["action-1", "action-2"]
      }
    };

    const findings = await evaluator.onEvent(event, {
      run,
      clock: {
        now: () => new Date("2026-04-09T00:00:07.000Z")
      }
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("functional");
    expect(findings[0]?.summary).toContain("submit-guess");
    expect(findings[0]?.metadata?.stateExpectation?.failedEffects).toHaveLength(1);
  });
});
