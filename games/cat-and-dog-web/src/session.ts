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
import { CAT_AND_DOG_SELECTORS } from "./selectors.js";
import { parseCatAndDogShell } from "./snapshot/parse-shell.js";

const DEFAULT_CAT_AND_DOG_URL = "https://cat-and-dog-p6qd.onrender.com/";

const GAMEPLAY_ENTRY_ACTION: GameActionSpec = {
  actionId: "enter-gameplay",
  description: "Enter gameplay on desktop route and send one gameplay interaction."
};

const START_CONTROL_SELECTOR = CAT_AND_DOG_SELECTORS.startControlCandidates.join(", ");

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

function resolveGameplayEntryUrl(): string {
  const parsed = new URL(resolveGameUrl());
  if (process.env.GAME_BOTS_CAT_AND_DOG_URL) {
    return parsed.toString();
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (!normalizedPath.endsWith(CAT_AND_DOG_SELECTORS.gameplayEntryRoute)) {
    parsed.pathname = `${normalizedPath}${CAT_AND_DOG_SELECTORS.gameplayEntryRoute}`;
  }

  return parsed.toString();
}

export class CatAndDogGameSession implements GameSession {
  private gameplayActionExecuted = false;

  async bootstrap(environment: EnvironmentSession): Promise<void> {
    await environment.execute({
      kind: "navigate",
      url: resolveGameplayEntryUrl()
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
      isTerminal: this.gameplayActionExecuted,
      semanticState: {
        status: shell.status,
        routePath: shell.routePath,
        hasAppRoot: shell.hasAppRoot,
        hasPlayableSurface: shell.hasPlayableSurface,
        hasGameplayHud: shell.hasGameplayHud,
        hasStartControl: shell.hasStartControl,
        gameplayEntered: shell.gameplayEntered,
        gameplayActionExecuted: this.gameplayActionExecuted
      },
      metrics: {
        hasPlayableSurface: shell.hasPlayableSurface ? 1 : 0,
        hasGameplayHud: shell.hasGameplayHud ? 1 : 0
      }
    };
  }

  async actions(snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    if (this.gameplayActionExecuted) {
      return [];
    }

    void snapshot;
    return [GAMEPLAY_ENTRY_ACTION];
  }

  async resolveAction(action: GameActionRequest, snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    if (action.actionId !== GAMEPLAY_ENTRY_ACTION.actionId) {
      throw new Error(`Unsupported cat-and-dog action: ${action.actionId}`);
    }

    const gameplayEntered = snapshot.semanticState.gameplayEntered === true;
    this.gameplayActionExecuted = true;

    const actions: EnvironmentAction[] = [];
    if (!gameplayEntered && snapshot.semanticState.hasStartControl === true) {
      actions.push({
        kind: "click",
        target: {
          selector: START_CONTROL_SELECTOR
        }
      });
      actions.push({
        kind: "wait",
        durationMs: 450
      });
    }

    actions.push(
      {
        kind: "keypress",
        key: "Space"
      },
      {
        kind: "wait",
        durationMs: 300
      }
    );

    return actions;
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [CAT_AND_DOG_SMOKE_SCENARIO];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [new MissingShellEvaluator()];
  }
}
