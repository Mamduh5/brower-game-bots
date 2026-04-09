import type { EnvironmentAction, EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type {
  GameActionRequest,
  GameActionSpec,
  GameSession,
  GameSnapshot,
  TestScenario
} from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import { PLAY2048_SMOKE_SCENARIO } from "./scenarios/smoke.scenario.js";
import { PLAY2048_SELECTORS } from "./selectors.js";
import { parsePlay2048State } from "./snapshot/parse-game-state.js";

const DEFAULT_PLAY2048_URL = "https://play2048.co/";

const NUDGE_LEFT_ACTION: GameActionSpec = {
  actionId: "nudge-left",
  description: "Send one left-arrow input to validate keyboard interaction."
};

const RESTART_ACTION: GameActionSpec = {
  actionId: "restart-game",
  description: "Reset the board by using the visible restart control."
};

const WAIT_FOR_READY_ACTION: GameActionSpec = {
  actionId: "wait-for-ready",
  description: "Pause briefly while the game shell stabilizes."
};

function resolvePlay2048Url(): string {
  const configured = (process.env.GAME_BOTS_PLAY2048_URL ?? DEFAULT_PLAY2048_URL).trim();

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch (error) {
    throw new Error(
      `Invalid GAME_BOTS_PLAY2048_URL '${configured}'. Set a valid http(s) URL. ${error instanceof Error ? error.message : ""}`.trim()
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported GAME_BOTS_PLAY2048_URL protocol '${parsed.protocol}'. Only http and https are supported.`
    );
  }

  return parsed.toString();
}

function resolveStatus(snapshot: GameSnapshot): string {
  const value = snapshot.semanticState.status;
  return typeof value === "string" ? value : "loading";
}

export class Play2048GameSession implements GameSession {
  async bootstrap(environment: EnvironmentSession): Promise<void> {
    await environment.execute({
      kind: "navigate",
      url: resolvePlay2048Url()
    });

    await environment.execute({
      kind: "wait",
      durationMs: 700
    });
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const state = parsePlay2048State(frame);
    const isTerminal = state.status === "won" || state.status === "over";

    return {
      title: "2048",
      isTerminal,
      semanticState: {
        status: state.status,
        hasGameContainer: state.hasGameContainer,
        score: state.score,
        bestScore: state.bestScore,
        tileCount: state.tileCount
      },
      metrics: {
        tileCount: state.tileCount,
        score: state.score
      }
    };
  }

  async actions(snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    const status = resolveStatus(snapshot);

    if (status === "loading") {
      return [WAIT_FOR_READY_ACTION];
    }

    if (snapshot.isTerminal) {
      return [RESTART_ACTION];
    }

    return [NUDGE_LEFT_ACTION];
  }

  async resolveAction(action: GameActionRequest, _snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    switch (action.actionId) {
      case "nudge-left":
        return [
          {
            kind: "keypress",
            key: "ArrowLeft"
          },
          {
            kind: "wait",
            durationMs: 250
          }
        ];
      case "restart-game":
        return [
          {
            kind: "click",
            target: {
              selector: PLAY2048_SELECTORS.restartButton
            }
          },
          {
            kind: "wait",
            durationMs: 350
          }
        ];
      case "wait-for-ready":
        return [
          {
            kind: "wait",
            durationMs: 450
          }
        ];
      default:
        throw new Error(`Unsupported Play2048 action: ${action.actionId}`);
    }
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [PLAY2048_SMOKE_SCENARIO];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [];
  }
}
