import { randomUUID } from "node:crypto";

import type { Finding, JsonValue, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

function toJsonObject(value: unknown): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;
}

function getByPath(value: JsonValue | undefined, path: string): JsonValue | undefined {
  const segments = path.split(".").filter((segment) => segment.length > 0);
  let current: JsonValue | undefined = value;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }

    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, JsonValue>)[segment];
  }

  return current;
}

function equalsJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface FailedExpectation {
  effectId: string;
  description: string;
  path: string;
  operator: string;
  preValue?: JsonValue;
  postValue?: JsonValue;
  expectedValue?: JsonValue;
}

function toJsonFailedEffects(failedExpectations: readonly FailedExpectation[]): JsonValue[] {
  return failedExpectations.map((expectation) => ({
    effectId: expectation.effectId,
    description: expectation.description,
    path: expectation.path,
    operator: expectation.operator,
    ...(expectation.preValue !== undefined ? { preValue: expectation.preValue } : {}),
    ...(expectation.postValue !== undefined ? { postValue: expectation.postValue } : {}),
    ...(expectation.expectedValue !== undefined ? { expectedValue: expectation.expectedValue } : {})
  }));
}

export class ExpectedStateChangeEvaluator implements Evaluator {
  readonly id = "expected-state-change-evaluator";

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (event.type !== "observation.captured" || event.observationKind !== "state-expectation") {
      return [];
    }

    const preState = toJsonObject(event.payload.preState);
    const postState = toJsonObject(event.payload.postState);
    const actionId = typeof event.payload.actionId === "string" ? event.payload.actionId : "unknown-action";
    const description =
      typeof event.payload.description === "string"
        ? event.payload.description
        : "Expected semantic state transition after action execution.";
    const effects = Array.isArray(event.payload.effects) ? event.payload.effects : [];

    if (!preState || !postState || effects.length === 0) {
      return [];
    }

    const failedExpectations: FailedExpectation[] = [];

    for (const effect of effects) {
      const expectation = toJsonObject(effect);
      if (!expectation) {
        continue;
      }

      const effectId = typeof expectation.effectId === "string" ? expectation.effectId : "unknown-effect";
      const effectDescription =
        typeof expectation.description === "string" ? expectation.description : "Semantic state effect.";
      const path = typeof expectation.path === "string" ? expectation.path : "";
      const operator = typeof expectation.operator === "string" ? expectation.operator : "changes";

      if (!path) {
        continue;
      }

      const preValue = getByPath(preState, path);
      const postValue = getByPath(postState, path);
      const expectedValue = expectation.expectedValue;
      const passed =
        operator === "equals" ? equalsJson(postValue, expectedValue) : !equalsJson(preValue, postValue);

      if (!passed) {
        failedExpectations.push({
          effectId,
          description: effectDescription,
          path,
          operator,
          ...(preValue !== undefined ? { preValue } : {}),
          ...(postValue !== undefined ? { postValue } : {}),
          ...(expectedValue !== undefined ? { expectedValue } : {})
        });
      }
    }

    if (failedExpectations.length === 0) {
      return [];
    }

    const preObservationEventId =
      typeof event.payload.preObservationEventId === "string" ? event.payload.preObservationEventId : undefined;
    const postObservationEventId =
      typeof event.payload.postObservationEventId === "string" ? event.payload.postObservationEventId : undefined;
    const actionEventIds = Array.isArray(event.payload.actionEventIds)
      ? event.payload.actionEventIds.filter((value): value is string => typeof value === "string")
      : [];

    return [
      {
        findingId: randomUUID(),
        runId: context.run.runId,
        scenarioId: context.run.scenarioId,
        title: "Action completed without the expected semantic state transition",
        summary:
          `Action '${actionId}' completed, but ${failedExpectations.length} expected semantic effect` +
          `${failedExpectations.length === 1 ? "" : "s"} did not occur.`,
        severity: "high",
        category: "functional",
        confidence: 0.94,
        evidence: [
          ...(preObservationEventId
            ? [
                {
                  eventId: preObservationEventId,
                  label: "pre-action-state",
                  detail: "Semantic snapshot before executing the action."
                }
              ]
            : []),
          ...(postObservationEventId
            ? [
                {
                  eventId: postObservationEventId,
                  label: "post-action-state",
                  detail: "Semantic snapshot after the action completed."
                }
              ]
            : []),
          ...actionEventIds.map((eventId, index) => ({
            eventId,
            label: `action-step-${index + 1}`,
            detail: `Browser interaction step ${index + 1} for semantic action '${actionId}'.`
          })),
          {
            eventId: event.eventId,
            label: "state-expectation",
            detail: description
          }
        ],
        reproSteps: [
          {
            order: 1,
            instruction: "Open the tester scenario and capture the semantic state before the action."
          },
          {
            order: 2,
            instruction: `Execute the semantic action '${actionId}'.`
          },
          {
            order: 3,
            instruction: "Compare expected semantic effects against the post-action state.",
            expected: failedExpectations.map((expectation) => expectation.description).join("; "),
            actual: failedExpectations
              .map(
                (expectation) =>
                  `${expectation.path} stayed at ${JSON.stringify(expectation.postValue ?? null)}`
              )
              .join("; ")
          }
        ],
        metadata: {
          stateExpectation: {
            actionId,
            failedEffects: toJsonFailedEffects(failedExpectations),
            preState,
            postState
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
