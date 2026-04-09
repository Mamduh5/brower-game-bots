import { randomUUID } from "node:crypto";

import type { Finding, JsonObject, RunEvent } from "@game-bots/contracts";
import type { EvaluationContext, Evaluator } from "@game-bots/runtime-core";

export class MissingShellEvaluator implements Evaluator {
  readonly id = "cat-and-dog-missing-shell";
  private openingEvaluated = false;
  private postActionEvaluated = false;

  private toShellState(event: Extract<RunEvent, { type: "observation.captured" }>): {
    hasAppRoot: boolean;
    hasPlayableSurface: boolean;
    hasGameplayHud: boolean;
    gameplayEntered: boolean;
    status: string;
  } {
    const semanticState = (event.payload.gameSemanticState ?? {}) as JsonObject;
    return {
      hasAppRoot: semanticState.hasAppRoot === true,
      hasPlayableSurface: semanticState.hasPlayableSurface === true,
      hasGameplayHud: semanticState.hasGameplayHud === true,
      gameplayEntered: semanticState.gameplayEntered === true,
      status: typeof semanticState.status === "string" ? semanticState.status : "unknown"
    };
  }

  async onEvent(event: RunEvent, context: EvaluationContext): Promise<readonly Finding[]> {
    if (event.type !== "observation.captured") {
      return [];
    }

    if (event.observationKind === "opening" && !this.openingEvaluated) {
      this.openingEvaluated = true;
      const shell = this.toShellState(event);

      if (shell.hasAppRoot || shell.hasPlayableSurface || shell.status !== "loading") {
        return [];
      }

      return [
        {
          findingId: randomUUID(),
          runId: context.run.runId,
          scenarioId: context.run.scenarioId,
          title: "Cat-and-dog shell was not detected on opening observation",
          summary:
            "The smoke run reached the route, but expected shell markers were missing (no app root and no playable surface were detected).",
          severity: "medium",
          category: "functional",
          confidence: 0.82,
          evidence: [
            {
              eventId: event.eventId,
              label: "opening-observation",
              detail: "Opening semantic snapshot reported loading state without shell markers."
            }
          ],
          reproSteps: [
            {
              order: 1,
              instruction: "Open https://cat-and-dog-p6qd.onrender.com/play/desktop/."
            },
            {
              order: 2,
              instruction: "Observe initial rendered shell.",
              expected: "A root app shell or playable surface is present.",
              actual: "No expected shell markers were detected."
            }
          ],
          metadata: {
            shell
          },
          createdAt: context.clock.now().toISOString()
        }
      ];
    }

    if (event.observationKind === "post-action" && !this.postActionEvaluated) {
      this.postActionEvaluated = true;
      const shell = this.toShellState(event);

      if (shell.gameplayEntered && shell.hasPlayableSurface) {
        return [];
      }

      return [
        {
          findingId: randomUUID(),
          runId: context.run.runId,
          scenarioId: context.run.scenarioId,
          title: "Cat-and-dog gameplay state was not reached after smoke action",
          summary:
            "The smoke action executed, but semantic post-action snapshot still did not indicate gameplay entry markers.",
          severity: "high",
          category: "functional",
          confidence: 0.88,
          evidence: [
            {
              eventId: event.eventId,
              label: "post-action-observation",
              detail: "Post-action semantic snapshot did not contain gameplay markers."
            }
          ],
          reproSteps: [
            {
              order: 1,
              instruction: "Open cat-and-dog desktop route."
            },
            {
              order: 2,
              instruction: "Execute smoke gameplay-entry action."
            },
            {
              order: 3,
              instruction: "Inspect post-action view.",
              expected: "Gameplay HUD/canvas state is active.",
              actual: "Gameplay markers were not detected."
            }
          ],
          metadata: {
            shell
          },
          createdAt: context.clock.now().toISOString()
        }
      ];
    }

    return [];
  }

  async finalize(_context: EvaluationContext): Promise<readonly Finding[]> {
    return [];
  }
}
