import { describe, expect, it } from "vitest";

import { RunEventSchema, RunRequestSchema } from "../src/index.js";

describe("RunRequestSchema", () => {
  it("defaults config to an empty object", () => {
    const parsed = RunRequestSchema.parse({
      agentKind: "tester",
      gameId: "wordle-web",
      environmentId: "playwright-browser"
    });

    expect(parsed.config).toEqual({});
  });
});

describe("RunEventSchema", () => {
  it("parses a run.created event", () => {
    const parsed = RunEventSchema.parse({
      eventId: "evt-1",
      runId: "run-1",
      sequence: 0,
      timestamp: "2026-04-09T00:00:00.000Z",
      type: "run.created",
      phase: "created",
      request: {
        agentKind: "player",
        gameId: "wordle-web",
        environmentId: "playwright-browser",
        config: {}
      }
    });

    expect(parsed.type).toBe("run.created");
  });
});
