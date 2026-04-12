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
import { CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID } from "./profiles.js";
import { parseCatAndDogRuntimeState } from "./runtime-probe.js";
import { CAT_AND_DOG_SMOKE_SCENARIO } from "./scenarios/smoke.scenario.js";
import { CAT_AND_DOG_SELECTORS } from "./selectors.js";
import { parseCatAndDogShell } from "./snapshot/parse-shell.js";
import {
  parseCatAndDogVisionFrame,
  summarizeCatAndDogVision,
  type CatAndDogVisionState
} from "./vision/analyze-canvas.js";

const DEFAULT_CAT_AND_DOG_URL = "https://cat-and-dog-p6qd.onrender.com/";

const SELECT_TWO_PLAYER_MODE_ACTION: GameActionSpec = {
  actionId: "select-two-player-mode",
  description: "Select the 2-player mode from the mode-selection menu."
};

const ADJUST_AIM_LEFT_ACTION: GameActionSpec = {
  actionId: "adjust-aim-left",
  description: "Send one real gameplay control input (A) to adjust aim left."
};

const OPEN_CPU_SETUP_ACTION: GameActionSpec = {
  actionId: "open-cpu-setup",
  description: "Open the real Play vs CPU flow from the menu."
};

const START_CPU_MATCH_ACTION: GameActionSpec = {
  actionId: "start-cpu-match",
  description: "Start a CPU match using the selected difficulty."
};

const EXECUTE_PLANNED_SHOT_ACTION: GameActionSpec = {
  actionId: "execute-planned-shot",
  description: "Apply a planned real shot: choose weapon, adjust aim/power, then fire."
};

const WAIT_FOR_TURN_RESOLUTION_ACTION: GameActionSpec = {
  actionId: "wait-for-turn-resolution",
  description: "Wait for the active turn or projectile resolution to complete."
};

const TWO_PLAYER_SELECTOR = CAT_AND_DOG_SELECTORS.twoPlayerButtonCandidates.join(", ");
const PLAY_CPU_SELECTOR = CAT_AND_DOG_SELECTORS.playCpuButtonCandidates.join(", ");
const START_CPU_SELECTOR = CAT_AND_DOG_SELECTORS.startCpuButtonCandidates.join(", ");
const EASY_DIFFICULTY_SELECTOR = CAT_AND_DOG_SELECTORS.easyDifficultyCandidates.join(", ");

function readStringParam(
  params: GameActionRequest["params"],
  key: string
): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readIntegerParam(
  params: GameActionRequest["params"],
  key: string,
  fallback: number
): number {
  const value = params?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function buildRepeatedKeypresses(key: string, count: number): EnvironmentAction[] {
  return Array.from({ length: count }, () => ({
    kind: "keypress" as const,
    key
  }));
}

function toDigitKey(weaponKey: string | null): string {
  switch (weaponKey) {
    case "light":
      return "2";
    case "heavy":
      return "3";
    case "super":
      return "4";
    case "heal":
      return "5";
    default:
      return "1";
  }
}

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
  private readonly isPlayerUntilWinProfile: boolean;
  private previousVisionFrame: CatAndDogVisionState | null = null;

  constructor(private readonly context: { profileId?: string } = {}) {
    this.isPlayerUntilWinProfile = context.profileId === CAT_AND_DOG_PLAYER_UNTIL_WIN_PROFILE_ID;
  }

  async bootstrap(environment: EnvironmentSession): Promise<void> {
    await environment.execute({
      kind: "navigate",
      url: resolveGameplayEntryUrl()
    });

    await environment.execute({
      kind: "wait",
      durationMs: 450
    });
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const shell = parseCatAndDogShell(frame);
    const runtime = parseCatAndDogRuntimeState(frame);
    const currentVisionFrame = parseCatAndDogVisionFrame(
      typeof frame.payload.primaryCanvasPngBase64 === "string" ? frame.payload.primaryCanvasPngBase64 : null
    );
    const visionSummary = summarizeCatAndDogVision(currentVisionFrame, this.previousVisionFrame);
    this.previousVisionFrame = currentVisionFrame ?? this.previousVisionFrame;

    return {
      title: "Cat and Dog",
      isTerminal: this.isPlayerUntilWinProfile
        ? shell.endVisible
        : this.modeSelectionExecuted && this.gameplayInteractionExecuted,
      semanticState: {
        status: shell.status,
        routePath: shell.routePath,
        hasAppRoot: shell.hasAppRoot,
        hasModeSelection: shell.hasModeSelection,
        hasTwoPlayerOption: shell.hasTwoPlayerOption,
        hasPlayCpuOption: shell.hasPlayCpuOption,
        hasPlayableSurface: shell.hasPlayableSurface,
        hasGameplayHud: shell.hasGameplayHud,
        hasGameplayControls: shell.hasGameplayControls,
        aimStatusText: shell.aimStatusText,
        aimDirection: shell.aimDirection,
        powerStatusText: shell.powerStatusText,
        gameplayInputApplied: shell.gameplayInputApplied,
        hasStartControl: shell.hasStartControl,
        gameplayEntered: shell.gameplayEntered,
        menuVisible: shell.menuVisible,
        cpuSetupVisible: shell.cpuSetupVisible,
        startCpuAvailable: shell.startCpuAvailable,
        weaponBarVisible: shell.weaponBarVisible,
        selectedWeaponKey: shell.selectedWeaponKey,
        modeLabelText: shell.modeLabelText,
        matchNoteText: shell.matchNoteText,
        canvasHintVisible: shell.canvasHintVisible,
        canvasHintText: shell.canvasHintText,
        canvasHintCategory: shell.canvasHintCategory,
        turnBannerVisible: shell.turnBannerVisible,
        turnBannerLabelText: shell.turnBannerLabelText,
        turnBannerTitleText: shell.turnBannerTitleText,
        playerHpText: shell.playerHpText,
        playerHpValue: shell.playerHpValue,
        playerHpMax: shell.playerHpMax,
        cpuHpText: shell.cpuHpText,
        cpuHpValue: shell.cpuHpValue,
        cpuHpMax: shell.cpuHpMax,
        hpTrackingAvailable: shell.hpTrackingAvailable,
        turnCounterText: shell.turnCounterText,
        turnCounter: shell.turnCounter,
        progressSignalSource: shell.progressSignalSource,
        shotResolutionCategory: shell.shotResolutionCategory,
        shotResolved: shell.shotResolved,
        runtimeStateAvailable: runtime.runtimeStateAvailable,
        runtimeStateSource: runtime.runtimeStateSource,
        runtimeStateError: runtime.runtimeStateError,
        runtimeScene: runtime.runtimeScene,
        runtimePhase: runtime.runtimePhase,
        runtimeMode: runtime.runtimeMode,
        currentPlayerIndex: runtime.currentPlayerIndex,
        currentPlayerName: runtime.currentPlayerName,
        cpuDifficulty: runtime.cpuDifficulty,
        windValue: runtime.windValue,
        windNormalized: runtime.windNormalized,
        windDirection: runtime.windDirection,
        windMax: runtime.windMax,
        preparedShotAngle: runtime.preparedShotAngle,
        preparedShotPower: runtime.preparedShotPower,
        preparedShotKey: runtime.preparedShotKey,
        preparedShotBossEcho: runtime.preparedShotBossEcho,
        projectileLabel: runtime.projectileLabel,
        projectileWeight: runtime.projectileWeight,
        projectileLaunchSpeedMultiplier: runtime.projectileLaunchSpeedMultiplier,
        projectileGravityMultiplier: runtime.projectileGravityMultiplier,
        projectileWindInfluenceMultiplier: runtime.projectileWindInfluenceMultiplier,
        projectileSplashRadius: runtime.projectileSplashRadius,
        projectileDamageMin: runtime.projectileDamageMin,
        projectileDamageMax: runtime.projectileDamageMax,
        projectileWindupSeconds: runtime.projectileWindupSeconds,
        endVisible: shell.endVisible,
        endTitleText: shell.endTitleText,
        endSubtitleText: shell.endSubtitleText,
        visionAvailable: visionSummary.visionAvailable,
        visionChangeRatio: visionSummary.visionChangeRatio,
        visionChangeStrength: visionSummary.visionChangeStrength,
        visionChangeFocus: visionSummary.visionChangeFocus,
        visionPlayerAnchorXRatio: visionSummary.visionPlayerAnchorXRatio,
        visionPlayerAnchorYRatio: visionSummary.visionPlayerAnchorYRatio,
        visionPlayerAnchorSource: visionSummary.visionPlayerAnchorSource,
        visionEnemyAnchorXRatio: visionSummary.visionEnemyAnchorXRatio,
        visionEnemyAnchorYRatio: visionSummary.visionEnemyAnchorYRatio,
        visionEnemyAnchorSource: visionSummary.visionEnemyAnchorSource,
        visionImpactXRatio: visionSummary.visionImpactXRatio,
        visionImpactYRatio: visionSummary.visionImpactYRatio,
        visionImpactRegion: visionSummary.visionImpactRegion,
        visionShotOutcomeLabel: visionSummary.visionShotOutcomeLabel,
        visionShotOutcomeConfidence: visionSummary.visionShotOutcomeConfidence,
        visionShotOutcomeSource: visionSummary.visionShotOutcomeSource,
        visionImpactCategory: visionSummary.visionImpactCategory,
        visionFrameWidth: visionSummary.visionFrameWidth,
        visionFrameHeight: visionSummary.visionFrameHeight,
        playerTurnReady: shell.playerTurnReady,
        outcome: shell.outcome,
        modeSelectionExecuted: this.modeSelectionExecuted,
        gameplayInteractionExecuted: this.gameplayInteractionExecuted
      },
      metrics: {
        hasModeSelection: shell.hasModeSelection ? 1 : 0,
        hasTwoPlayerOption: shell.hasTwoPlayerOption ? 1 : 0,
        hasPlayCpuOption: shell.hasPlayCpuOption ? 1 : 0,
        hasPlayableSurface: shell.hasPlayableSurface ? 1 : 0,
        hasGameplayHud: shell.hasGameplayHud ? 1 : 0,
        hasGameplayControls: shell.hasGameplayControls ? 1 : 0,
        gameplayInputApplied: shell.gameplayInputApplied ? 1 : 0,
        playerTurnReady: shell.playerTurnReady ? 1 : 0,
        canvasHintVisible: shell.canvasHintVisible ? 1 : 0,
        canvasHintCategory:
          shell.canvasHintCategory === "combat-result"
            ? 3
            : shell.canvasHintCategory === "turn-status"
              ? 2
              : shell.canvasHintCategory === "instructional"
                ? 1
                : 0,
        turnBannerVisible: shell.turnBannerVisible ? 1 : 0,
        shotResolved: shell.shotResolved ? 1 : 0,
        hpTrackingAvailable: shell.hpTrackingAvailable ? 1 : 0,
        runtimeStateAvailable: runtime.runtimeStateAvailable ? 1 : 0,
        windValue: runtime.windValue ?? 0,
        windNormalized: runtime.windNormalized ?? 0,
        projectileWeight: runtime.projectileWeight ?? 0,
        projectileWindInfluenceMultiplier: runtime.projectileWindInfluenceMultiplier ?? 0,
        visionAvailable: visionSummary.visionAvailable ? 1 : 0,
        visionChangeRatio: visionSummary.visionChangeRatio ?? 0,
        visionStrongChange: visionSummary.visionChangeStrength === "strong" ? 1 : 0,
        visionTargetSideActivity: visionSummary.visionImpactCategory === "target-side-activity" ? 1 : 0,
        visionNearTarget:
          visionSummary.visionShotOutcomeLabel === "near-target" ? 1 : 0,
        visionBlocked:
          visionSummary.visionShotOutcomeLabel === "blocked" ? 1 : 0,
        visionShort:
          visionSummary.visionShotOutcomeLabel === "short" ? 1 : 0,
        visionLong:
          visionSummary.visionShotOutcomeLabel === "long" ? 1 : 0,
        playerHpValue: shell.playerHpValue ?? -1,
        cpuHpValue: shell.cpuHpValue ?? -1,
        turnCounter: shell.turnCounter ?? 0,
        endVisible: shell.endVisible ? 1 : 0
      }
    };
  }

  async actions(snapshot: GameSnapshot): Promise<readonly GameActionSpec[]> {
    if (this.isPlayerUntilWinProfile) {
      if (
        snapshot.semanticState.outcome === "win" ||
        snapshot.semanticState.outcome === "loss" ||
        snapshot.semanticState.endVisible === true ||
        snapshot.isTerminal === true
      ) {
        return [];
      }

      if (snapshot.semanticState.gameplayEntered !== true) {
        if (snapshot.semanticState.menuVisible === true && snapshot.semanticState.cpuSetupVisible !== true) {
          return snapshot.semanticState.hasPlayCpuOption === true ? [OPEN_CPU_SETUP_ACTION] : [];
        }

        if (snapshot.semanticState.menuVisible === true && snapshot.semanticState.cpuSetupVisible === true) {
          return snapshot.semanticState.startCpuAvailable === true ? [START_CPU_MATCH_ACTION] : [];
        }

        return [];
      }

      if (snapshot.semanticState.playerTurnReady === true) {
        return [EXECUTE_PLANNED_SHOT_ACTION];
      }

      return [WAIT_FOR_TURN_RESOLUTION_ACTION];
    }

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
    if (this.isPlayerUntilWinProfile) {
      if (action.actionId === OPEN_CPU_SETUP_ACTION.actionId) {
        return [
          {
            kind: "click",
            target: {
              selector: PLAY_CPU_SELECTOR
            }
          },
          {
            kind: "wait",
            durationMs: 220
          }
        ];
      }

      if (action.actionId === START_CPU_MATCH_ACTION.actionId) {
        const difficulty = readStringParam(action.params, "difficulty") ?? "easy";
        const difficultySelector = `#difficultyPanel [data-difficulty='${difficulty}']`;

        return [
          {
            kind: "click",
            target: {
              selector: difficultySelector || EASY_DIFFICULTY_SELECTOR
            }
          },
          {
            kind: "wait",
            durationMs: 120
          },
          {
            kind: "click",
            target: {
              selector: START_CPU_SELECTOR
            }
          },
          {
            kind: "wait",
            durationMs: 360
          }
        ];
      }

      if (action.actionId === EXECUTE_PLANNED_SHOT_ACTION.actionId) {
        const weaponKey = readStringParam(action.params, "weaponKey");
        const angleDirection = readStringParam(action.params, "angleDirection") === "left" ? "left" : "right";
        const powerDirection = readStringParam(action.params, "powerDirection") === "down" ? "down" : "up";
        const angleTapCount = readIntegerParam(action.params, "angleTapCount", 1);
        const powerTapCount = readIntegerParam(action.params, "powerTapCount", 1);
        const settleMs = readIntegerParam(action.params, "settleMs", 150);
        const turnResolutionWaitMs = readIntegerParam(action.params, "turnResolutionWaitMs", 1800);
        const postFireObserveDelayMs = Math.max(260, Math.min(700, Math.floor(turnResolutionWaitMs / 3)));

        if (snapshot.semanticState.playerTurnReady !== true) {
          throw new Error("Cannot execute a planned shot before the player turn is ready.");
        }

        return [
          {
            kind: "keypress",
            key: toDigitKey(weaponKey)
          },
          {
            kind: "wait",
            durationMs: 70
          },
          ...buildRepeatedKeypresses(angleDirection === "left" ? "A" : "D", angleTapCount),
          ...buildRepeatedKeypresses(powerDirection === "down" ? "S" : "W", powerTapCount),
          {
            kind: "wait",
            durationMs: settleMs
          },
          {
            kind: "keypress",
            key: "Space"
          },
          {
            kind: "wait",
            durationMs: postFireObserveDelayMs
          }
        ];
      }

      if (action.actionId === WAIT_FOR_TURN_RESOLUTION_ACTION.actionId) {
        return [
          {
            kind: "wait",
            durationMs: readIntegerParam(action.params, "durationMs", 1800)
          }
        ];
      }
    }

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
