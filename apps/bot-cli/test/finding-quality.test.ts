import { describe, expect, it } from "vitest";

import type { ArtifactRef, Finding } from "@game-bots/contracts";

import { finalizeFindingsQuality, withEvaluatorMetadata } from "../src/commands/finding-quality.js";

function buildBaseFinding(overrides: Partial<Finding>): Finding {
  return {
    findingId: "finding-1",
    runId: "run-1",
    title: "Successful action did not change semantic state",
    summary: "A successful action did not produce a meaningful semantic transition.",
    severity: "medium",
    category: "functional",
    confidence: 0.8,
    evidence: [
      {
        eventId: "post-evt",
        label: "post-action-state"
      }
    ],
    reproSteps: [
      {
        order: 1,
        instruction: "Execute the scenario action."
      }
    ],
    createdAt: "2026-04-09T00:00:00.000Z",
    ...overrides
  };
}

describe("withEvaluatorMetadata", () => {
  it("attaches evaluator source and preserves existing metadata", () => {
    const tagged = withEvaluatorMetadata(
      buildBaseFinding({
        metadata: {
          clickProbe: {
            probeId: "probe-1"
          }
        }
      }),
      "clickability-evaluator"
    );

    expect(tagged.metadata?.clickProbe).toBeDefined();
    expect(tagged.metadata?.sources).toEqual(["clickability-evaluator"]);
  });
});

describe("finalizeFindingsQuality", () => {
  it("suppresses redundant freeze finding when state expectation finding exists for the same post-action event", () => {
    const freezeFinding = buildBaseFinding({});
    const expectationFinding = buildBaseFinding({
      findingId: "finding-2",
      title: "Action completed without the expected semantic state transition",
      summary: "Expected semantic effect was not observed.",
      severity: "high",
      metadata: {
        stateExpectation: {
          actionId: "submit-guess",
          failedEffects: []
        }
      }
    });

    const artifacts: ArtifactRef[] = [
      {
        artifactId: "artifact-1",
        runId: "run-1",
        kind: "dom-snapshot",
        relativePath: "captures/dom.html",
        contentType: "text/html",
        createdAt: "2026-04-09T00:00:01.000Z"
      }
    ];

    const finalized = finalizeFindingsQuality([freezeFinding, expectationFinding], artifacts);

    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.title).toContain("expected semantic state transition");
    expect(finalized[0]?.evidence.some((entry) => entry.artifactId === "artifact-1")).toBe(true);
  });

  it("deduplicates identical findings emitted more than once", () => {
    const first = buildBaseFinding({
      findingId: "finding-1",
      confidence: 0.7
    });
    const second = buildBaseFinding({
      findingId: "finding-2",
      confidence: 0.9
    });

    const finalized = finalizeFindingsQuality([first, second], []);
    expect(finalized).toHaveLength(1);
    expect(finalized[0]?.confidence).toBe(0.9);
  });
});
