import { describe, expect, it } from "vitest";

import type { RunEvent, RunRecord } from "@game-bots/contracts";

import { CrashDetector } from "../src/evaluators/crash-detector.js";

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

describe("CrashDetector", () => {
  it("creates a finding when environment health is degraded or failed", async () => {
    const detector = new CrashDetector();
    const event: RunEvent = {
      eventId: "event-health-1",
      runId: run.runId,
      sequence: 3,
      timestamp: "2026-04-09T00:00:03.000Z",
      type: "observation.captured",
      observationKind: "environment-health",
      summary: "Page became unresponsive.",
      payload: {
        healthStatus: "failed",
        healthCheckedAt: "2026-04-09T00:00:03.000Z",
        healthDetail: "Browser page became unresponsive.",
        healthSignals: {
          unresponsive: true
        }
      }
    };

    const findings = await detector.onEvent(event, {
      run,
      clock: {
        now: () => new Date("2026-04-09T00:00:04.000Z")
      }
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("crash");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.evidence[0]?.eventId).toBe(event.eventId);
  });
});
