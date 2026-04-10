import type { RunEvent } from "@game-bots/contracts";
import type { AgentContext, AgentDecision, DecisionInput } from "@game-bots/runtime-core";

import {
  CatAndDogAttemptStrategySchema,
  type CatAndDogAttemptStrategy
} from "../domain/cat-and-dog-attempt-strategy.js";
import type { PlayerPolicy } from "../domain/player-policy.js";

function readLatestCatAndDogStrategy(events: readonly RunEvent[]): CatAndDogAttemptStrategy | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "observation.captured" || event.observationKind !== "attempt.started") {
      continue;
    }

    const parsed = CatAndDogAttemptStrategySchema.safeParse(event.payload.strategy);
    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
}

export class RuleBasedPlayerPolicy implements PlayerPolicy {
  readonly kind = "player" as const;
  private initialized = false;

  async initialize(_context: AgentContext): Promise<void> {
    this.initialized = true;
  }

  async decide(input: DecisionInput): Promise<AgentDecision> {
    if (!this.initialized) {
      throw new Error("Player policy must be initialized before deciding.");
    }

    if (input.availableActions.length === 0 || input.gameState.isTerminal === true) {
      return { type: "complete", reason: "No further semantic actions are available." };
    }

    const strategy = readLatestCatAndDogStrategy(input.recentEvents);
    const availableActionIds = new Set(input.availableActions.map((action) => action.actionId));

    if (availableActionIds.has("open-cpu-setup")) {
      return {
        type: "game-action",
        actionId: "open-cpu-setup"
      };
    }

    if (availableActionIds.has("start-cpu-match")) {
      return {
        type: "game-action",
        actionId: "start-cpu-match",
        params: {
          difficulty: strategy?.difficulty ?? "easy"
        }
      };
    }

    if (availableActionIds.has("execute-planned-shot")) {
      return {
        type: "game-action",
        actionId: "execute-planned-shot",
        params: strategy
          ? {
              weaponKey: strategy.weaponKey,
              angleDirection: strategy.angleDirection,
              angleTapCount: strategy.angleTapCount,
              powerDirection: strategy.powerDirection,
              powerTapCount: strategy.powerTapCount,
              settleMs: strategy.settleMs,
              turnResolutionWaitMs: strategy.turnResolutionWaitMs
            }
          : {
              weaponKey: "normal",
              angleDirection: "right",
              angleTapCount: 1,
              powerDirection: "up",
              powerTapCount: 1,
              settleMs: 150,
              turnResolutionWaitMs: 1800
            }
      };
    }

    if (availableActionIds.has("wait-for-turn-resolution")) {
      const turnBannerVisible = input.gameState.turnBannerVisible === true;
      const shotResolved = input.gameState.shotResolved === true;
      const resolutionWaitMs = strategy?.turnResolutionWaitMs ?? 1800;
      return {
        type: "game-action",
        actionId: "wait-for-turn-resolution",
        params: {
          durationMs: shotResolved
            ? 300
            : turnBannerVisible
              ? 400
              : Math.min(900, Math.max(450, Math.floor(resolutionWaitMs / 2)))
        }
      };
    }

    const [firstAction] = input.availableActions;
    if (!firstAction) {
      return { type: "complete", reason: "No action remained after evaluation." };
    }

    return {
      type: "game-action",
      actionId: firstAction.actionId
    };
  }
}
