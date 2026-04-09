import type { EnvironmentAction, EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type {
  GameActionRequest,
  GameActionSpec,
  GameSession,
  GameSnapshot,
  TestScenario
} from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import { MissingShellEvaluator } from "./evaluators/missing-shell-evaluator.js";
import { CAT_AND_DOG_SMOKE_SCENARIO } from "./scenarios/smoke.scenario.js";
import { parseCatAndDogShell } from "./snapshot/parse-shell.js";

const DEFAULT_CAT_AND_DOG_URL = "https://cat-and-dog-p6qd.onrender.com/";

const INTERACTION_PULSE_ACTION: GameActionSpec = {
  actionId: "interaction-pulse",
  description: "Send one keyboard pulse to validate baseline game interaction."
};

function resolveGameUrl(): string {
  const raw = (process.env.GAME_BOTS_CAT_AND_DOG_URL ?? DEFAULT_CAT_AND_DOG_URL).trim();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(
      `Invalid GAME_BOTS_CAT_AND_DOG_URL '${raw}'. Set a valid http(s) URL. ${error instanceof Error ? error.message : ""}`.trim()
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    throw new Error(
      `Unsupported GAME_BOTS_CAT_AND_DOG_URL protocol '${parsed.protocol}'. Only http, https, and file are supported.`
    );
  }

  return parsed.toString();
}

export class CatAndDogGameSession implements GameSession {
  private interactionExecuted = false;

  async bootstrap(environment: EnvironmentSession): Promise<void> {
    await environment.execute({
      kind: "navigate",
      url: resolveGameUrl()
    });

    await environment.execute({
      kind: "wait",
      durationMs: 800
    });
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const shell = parseCatAndDogShell(frame);

    return {
      title: "Cat and Dog",
      isTerminal: this.interactionExecuted,
      semanticState: {
        status: shell.status,
        routePath: shell.routePath,
        hasAppRoot: shell.hasAppRoot,
        hasPlayableSurface: shell.hasPlayableSurface,
        interactionExecuted: this.interactionExecuted
      },
      metrics: {
        hasPlayableSurface: shell.hasPlayableSurface ? 1 : 0
      }
    };
  }

  async actions(_snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    if (this.interactionExecuted) {
      return [];
    }

    return [INTERACTION_PULSE_ACTION];
  }

  async resolveAction(action: GameActionRequest, _snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    if (action.actionId !== INTERACTION_PULSE_ACTION.actionId) {
      throw new Error(`Unsupported cat-and-dog action: ${action.actionId}`);
    }

    this.interactionExecuted = true;

    return [
      {
        kind: "keypress",
        key: "Space"
      },
      {
        kind: "wait",
        durationMs: 300
      }
    ];
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [CAT_AND_DOG_SMOKE_SCENARIO];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [new MissingShellEvaluator()];
  }
}
