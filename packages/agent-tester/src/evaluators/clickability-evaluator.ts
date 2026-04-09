import { randomUUID } from "node:crypto";

import type { Finding, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class ClickabilityEvaluator implements Evaluator {
  readonly id = "clickability-evaluator";

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (event.type !== "observation.captured" || event.observationKind !== "click-probe") {
      return [];
    }

    const successRatio = toNumber(event.payload.successRatio);
    const minimumSuccessRatio = toNumber(event.payload.minimumSuccessRatio);
    const totalSamples = toNumber(event.payload.totalSamples);
    const successfulSamples = toNumber(event.payload.successfulSamples);
    const probeId = typeof event.payload.probeId === "string" ? event.payload.probeId : "click-probe";
    const description =
      typeof event.payload.description === "string" ? event.payload.description : "Visible control clickability probe.";
    const surfaceSelector =
      typeof event.payload.surfaceSelector === "string" ? event.payload.surfaceSelector : "unknown-surface";
    const activationSelector =
      typeof event.payload.activationSelector === "string" ? event.payload.activationSelector : undefined;

    if (
      successRatio === null ||
      minimumSuccessRatio === null ||
      totalSamples === null ||
      successfulSamples === null ||
      successRatio >= minimumSuccessRatio
    ) {
      return [];
    }

    const severity = successRatio === 0 ? "high" : "medium";
    const failedSamples = Array.isArray(event.payload.sampleResults)
      ? event.payload.sampleResults.filter(
          (sample): sample is { label: string; clickStatus: string } =>
            typeof sample === "object" &&
            sample !== null &&
            "label" in sample &&
            typeof sample.label === "string" &&
            "clickStatus" in sample &&
            typeof sample.clickStatus === "string" &&
            sample.clickStatus !== "succeeded"
        )
      : [];

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: "Visible control has a smaller clickable region than it appears",
        summary:
          `Probe '${probeId}' only succeeded at ${successfulSamples}/${totalSamples} sampled points ` +
          `(${Math.round(successRatio * 100)}%), below the expected ${Math.round(minimumSuccessRatio * 100)}% threshold.`,
        severity,
        category: "ui",
        confidence: 0.93,
        evidence: [
          {
            eventId: event.eventId,
            label: "click-probe",
            detail: description
          }
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Open the tester scenario and locate the visible control under probe."
          },
          {
            order: 2,
            instruction: `Attempt clicks across the visible bounds of '${surfaceSelector}'.`,
            expected: activationSelector
              ? `Clicks across the visible control consistently activate '${activationSelector}'.`
              : "Clicks across the visible control consistently activate the control."
          },
          {
            order: 3,
            instruction: "Compare center clicks versus edge and corner clicks.",
            actual:
              failedSamples.length > 0
                ? `Failed sampled regions: ${failedSamples.map((sample) => sample.label).join(", ")}.`
                : "Only a subset of the visible control area accepted interaction."
          }
        ],
        metadata: {
          clickProbe: {
            probeId,
            surfaceSelector,
            ...(activationSelector ? { activationSelector } : {}),
            minimumSuccessRatio,
            successRatio,
            totalSamples,
            successfulSamples,
            sampleResults: Array.isArray(event.payload.sampleResults) ? event.payload.sampleResults : [],
            ...(event.payload.visibleBounds && typeof event.payload.visibleBounds === "object"
              ? { visibleBounds: event.payload.visibleBounds }
              : {})
          }
        },
        createdAt: context.clock.now().toISOString()
      }
    ];
  }

  async finalize(_context: EvaluationContext): Promise<readonly Finding[]> {
    return [];
  }
}
