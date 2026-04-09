import { describe, expect, it } from "vitest";

import type { RunEvent, RunRecord } from "@game-bots/contracts";

import { UiHeuristicsEvaluator } from "../src/evaluators/ui-heuristics.js";

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

describe("UiHeuristicsEvaluator", () => {
  it("creates a finding when an action event reports failure", async () => {
    const evaluator = new UiHeuristicsEvaluator();
    const event: RunEvent = {
      eventId: "event-action-failed",
      runId: run.runId,
      sequence: 2,
      timestamp: "2026-04-09T00:00:02.000Z",
      type: "action.executed",
      actionKind: "click",
      status: "failed",
      summary: "Locator '#submit-guess' was not clickable.",
      payload: {
        action: "click",
        targetSelector: "#submit-guess",
        errorCode: "action_failed"
      }
    };

    const findings = await evaluator.onEvent(event, {
      run,
      clock: {
        now: () => new Date("2026-04-09T00:00:03.000Z")
      }
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("ui");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.evidence[0]?.eventId).toBe(event.eventId);
  });
});
