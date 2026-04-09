import { describe, expect, it } from "vitest";

import { FindingSchema, RunEventSchema, RunRequestSchema } from "../src/index.js";

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

describe("FindingSchema", () => {
  it("accepts additive metadata for structured QA measurements", () => {
    const parsed = FindingSchema.parse({
      findingId: "finding-1",
      runId: "run-1",
      title: "Hitbox mismatch",
      summary: "Only the center of the button is clickable.",
      severity: "medium",
      category: "ui",
      confidence: 0.95,
      evidence: [
        {
          eventId: "evt-1",
          label: "click-probe"
        }
      ],
      reproSteps: [
        {
          order: 1,
          instruction: "Click the edges of the visible control."
        }
      ],
      metadata: {
        clickProbe: {
          successRatio: 0.11,
          minimumSuccessRatio: 0.5
        }
      },
      createdAt: "2026-04-09T00:00:01.000Z"
    });

    expect(parsed.metadata?.clickProbe).toBeDefined();
  });
});
