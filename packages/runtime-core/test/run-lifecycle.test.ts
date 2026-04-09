import { describe, expect, it } from "vitest";

import { RunLifecycle } from "../src/application/run-lifecycle.js";

describe("RunLifecycle", () => {
  it("transitions to a valid next phase", () => {
    const lifecycle = new RunLifecycle();

    const result = lifecycle.transition(
      {
        runId: "run-1",
        agentKind: "tester",
        gameId: "wordle-web",
        environmentId: "playwright-browser",
        phase: "created",
        status: "active",
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z",
        config: {}
      },
      "preparing",
      new Date("2026-04-09T00:01:00.000Z")
    );

    expect(result.phase).toBe("preparing");
    expect(result.status).toBe("active");
  });

  it("rejects invalid transitions", () => {
    const lifecycle = new RunLifecycle();

    expect(() =>
      lifecycle.transition(
        {
          runId: "run-1",
          agentKind: "tester",
          gameId: "wordle-web",
          environmentId: "playwright-browser",
          phase: "created",
          status: "active",
          createdAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z",
          config: {}
        },
        "completed",
        new Date("2026-04-09T00:01:00.000Z")
      )
    ).toThrow("Invalid run phase transition");
  });
});
