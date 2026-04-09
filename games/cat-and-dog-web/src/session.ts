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

const SELECT_TWO_PLAYER_MODE_ACTION: GameActionSpec = {
  actionId: "select-two-player-mode",
  description: "Select the 2-player mode from the mode-selection menu."
};

const ADJUST_AIM_LEFT_ACTION: GameActionSpec = {
  actionId: "adjust-aim-left",
  description: "Send one real gameplay control input (A) to adjust aim left."
};

const TWO_PLAYER_SELECTOR = CAT_AND_DOG_SELECTORS.twoPlayerButtonCandidates.join(", ");

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
  if (!normalizedPath.endsWith(CAT_AND_DOG_SELECTORS.gameplayEntryRoute.replace(/\/+$/, ""))) {
    parsed.pathname = `${normalizedPath}${CAT_AND_DOG_SELECTORS.gameplayEntryRoute}`;
  }

  return parsed.toString();
}

export class CatAndDogGameSession implements GameSession {
  private modeSelectionExecuted = false;
  private gameplayInteractionExecuted = false;

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
      isTerminal: this.modeSelectionExecuted && this.gameplayInteractionExecuted,
      semanticState: {
        status: shell.status,
        routePath: shell.routePath,
        hasAppRoot: shell.hasAppRoot,
        hasModeSelection: shell.hasModeSelection,
        hasTwoPlayerOption: shell.hasTwoPlayerOption,
        hasPlayableSurface: shell.hasPlayableSurface,
        hasGameplayHud: shell.hasGameplayHud,
        hasGameplayControls: shell.hasGameplayControls,
        aimStatusText: shell.aimStatusText,
        aimDirection: shell.aimDirection,
        gameplayInputApplied: shell.gameplayInputApplied,
        hasStartControl: shell.hasStartControl,
        gameplayEntered: shell.gameplayEntered,
        modeSelectionExecuted: this.modeSelectionExecuted,
        gameplayInteractionExecuted: this.gameplayInteractionExecuted
      },
      metrics: {
        hasModeSelection: shell.hasModeSelection ? 1 : 0,
        hasTwoPlayerOption: shell.hasTwoPlayerOption ? 1 : 0,
        hasPlayableSurface: shell.hasPlayableSurface ? 1 : 0,
        hasGameplayHud: shell.hasGameplayHud ? 1 : 0,
        hasGameplayControls: shell.hasGameplayControls ? 1 : 0,
        gameplayInputApplied: shell.gameplayInputApplied ? 1 : 0
      }
    };
  }

  async actions(snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    if (!this.modeSelectionExecuted) {
      return [SELECT_TWO_PLAYER_MODE_ACTION];
    }

    if (!snapshot.semanticState.gameplayEntered) {
      return [];
    }

    if (!this.gameplayInteractionExecuted) {
      return [ADJUST_AIM_LEFT_ACTION];
    }

    return [];
  }

  async resolveAction(action: GameActionRequest, snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    if (action.actionId === SELECT_TWO_PLAYER_MODE_ACTION.actionId) {
      this.modeSelectionExecuted = true;
      return [
        {
          kind: "click",
          target: {
            selector: TWO_PLAYER_SELECTOR
          }
        },
        {
          kind: "wait",
          durationMs: 500
        }
      ];
    }

    if (action.actionId === ADJUST_AIM_LEFT_ACTION.actionId) {
      if (snapshot.semanticState.gameplayEntered !== true) {
        throw new Error("Cannot run gameplay interaction before gameplay has started.");
      }

      this.gameplayInteractionExecuted = true;
      return [
        {
          kind: "keypress",
          key: "A"
        },
        {
          kind: "wait",
          durationMs: 250
        }
      ];
    }

    throw new Error(`Unsupported cat-and-dog action: ${action.actionId}`);
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [CAT_AND_DOG_SMOKE_SCENARIO];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [new MissingShellEvaluator()];
  }
}
