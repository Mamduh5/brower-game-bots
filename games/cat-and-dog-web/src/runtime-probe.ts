import type { JsonObject } from "@game-bots/contracts";
import type { ObservationFrame, ObservationRequest } from "@game-bots/environment-sdk";
import type { GameSnapshot } from "@game-bots/game-sdk";

export const CAT_AND_DOG_RUNTIME_PROBE_ID = "cat-and-dog-shot-context";

export interface CatAndDogRuntimeState {
  runtimeStateAvailable: boolean;
  runtimeStateSource: "fixture-hook" | "game-instance" | "error" | "unavailable";
  runtimeStateError: string | null;
  runtimeScene: string | null;
  runtimePhase: string | null;
  runtimeMode: string | null;
  currentPlayerIndex: number | null;
  currentPlayerName: string | null;
  cpuDifficulty: string | null;
  windValue: number | null;
  windNormalized: number | null;
  windDirection: "left" | "right" | "calm" | "unknown";
  windMax: number | null;
  preparedShotAngle: number | null;
  preparedShotPower: number | null;
  preparedShotKey: string | null;
  preparedShotBossEcho: boolean;
  projectileLabel: string | null;
  projectileWeight: number | null;
  projectileLaunchSpeedMultiplier: number | null;
  projectileGravityMultiplier: number | null;
  projectileWindInfluenceMultiplier: number | null;
  projectileSplashRadius: number | null;
  projectileDamageMin: number | null;
  projectileDamageMax: number | null;
  projectileWindupSeconds: number | null;
}

const CAT_AND_DOG_RUNTIME_PROBE_SCRIPT = String.raw`
return (async () => {
  const root = globalThis;

  const normalizeNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const normalizeString = (value) => (typeof value === "string" && value.length > 0 ? value : null);

  const buildFromState = (input) => {
    const state = input?.state ?? null;
    const config = input?.config ?? null;
    const currentPlayer = input?.currentPlayer ?? null;
    const preparedThrow = state?.preparedThrow ?? null;
    const selectedShotKey = normalizeString(
      currentPlayer?.weapon?.shotType ?? preparedThrow?.shotKey ?? null
    );
    const projectileConfig =
      selectedShotKey && config?.projectileTypes?.[selectedShotKey]
        ? config.projectileTypes[selectedShotKey]
        : null;
    const windValue = normalizeNumber(state?.wind);
    const windMax = normalizeNumber(config?.world?.maxWind);

    return {
      available: true,
      source: normalizeString(input?.source) ?? "unavailable",
      scene: normalizeString(state?.scene),
      phase: normalizeString(state?.phase),
      mode: normalizeString(state?.mode),
      currentPlayerIndex: normalizeNumber(state?.currentPlayerIndex),
      currentPlayerName: normalizeString(currentPlayer?.name),
      cpuDifficulty: normalizeString(state?.cpuDifficulty),
      windValue,
      windMax,
      preparedThrow: preparedThrow
        ? {
            playerIndex: normalizeNumber(preparedThrow.playerIndex),
            angle: normalizeNumber(preparedThrow.angle),
            power: normalizeNumber(preparedThrow.power),
            shotKey: normalizeString(preparedThrow.shotKey),
            bossEcho: Boolean(preparedThrow.bossEcho)
          }
        : null,
      projectileConfig: projectileConfig
        ? {
            label: normalizeString(projectileConfig.label),
            weight: normalizeNumber(projectileConfig.weight),
            launchSpeedMultiplier: normalizeNumber(projectileConfig.launchSpeedMultiplier),
            gravityMultiplier: normalizeNumber(projectileConfig.gravityMultiplier),
            windInfluenceMultiplier: normalizeNumber(projectileConfig.windInfluenceMultiplier),
            splashRadius: normalizeNumber(projectileConfig.splashRadius),
            damageMin: normalizeNumber(projectileConfig.damageMin),
            damageMax: normalizeNumber(projectileConfig.damageMax),
            windup: normalizeNumber(projectileConfig.windup)
          }
        : null
    };
  };

  try {
    const fixtureHook = root.__GAME_BOTS_CATDOG_RUNTIME__;
    if (typeof fixtureHook === "function") {
      const fixtureState = await fixtureHook();
      const built = buildFromState({
        source: "fixture-hook",
        ...fixtureState
      });
      if (built.available) {
        return built;
      }
    } else if (fixtureHook && typeof fixtureHook === "object") {
      const built = buildFromState({
        source: "fixture-hook",
        ...fixtureHook
      });
      if (built.available) {
        return built;
      }
    }

    if (!root.__GAME_BOTS_CATDOG_GAME_CAPTURE_INSTALLED__) {
      const module = await import("/src/core/Game.js");
      const Game = module?.Game;
      if (Game?.prototype && !Game.prototype.__gameBotsCaptureWrappedLoop__) {
        const originalLoop = Game.prototype.loop;
        Game.prototype.loop = function gameBotsCapturedLoop(...args) {
          root.__GAME_BOTS_CATDOG_GAME__ = this;
          return originalLoop.apply(this, args);
        };
        Object.defineProperty(Game.prototype, "__gameBotsCaptureWrappedLoop__", {
          configurable: true,
          enumerable: false,
          value: true,
          writable: false
        });
      }
      root.__GAME_BOTS_CATDOG_GAME_CAPTURE_INSTALLED__ = true;
    }

    if (!root.__GAME_BOTS_CATDOG_GAME__) {
      await new Promise((resolve) => root.requestAnimationFrame(() => resolve(undefined)));
    }

    const game = root.__GAME_BOTS_CATDOG_GAME__;
    if (!game?.state) {
      return {
        available: false,
        source: "unavailable",
        error: "cat-and-dog game instance was not available."
      };
    }

    const configModule = await import("/src/config.js");
    return buildFromState({
      source: "game-instance",
      state: game.state,
      config: configModule?.CONFIG ?? null,
      currentPlayer: typeof game.getCurrentPlayer === "function" ? game.getCurrentPlayer() : null
    });
  } catch (error) {
    return {
      available: false,
      source: "error",
      error: error instanceof Error ? error.message : "cat-and-dog runtime probe failed."
    };
  }
})();
`;

function readNestedObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function toWindDirection(windValue: number | null): CatAndDogRuntimeState["windDirection"] {
  if (windValue === null) {
    return "unknown";
  }

  if (Math.abs(windValue) < 0.001) {
    return "calm";
  }

  return windValue > 0 ? "right" : "left";
}

export function buildCatAndDogObservationRequest(input: {
  decisionActionId?: string;
  snapshot?: GameSnapshot;
}): ObservationRequest {
  const modes: ObservationRequest["modes"] =
    input.decisionActionId === "start-cpu-match" ||
    input.decisionActionId === "execute-planned-shot" ||
    input.decisionActionId === "wait-for-turn-resolution" ||
    input.snapshot?.semanticState.gameplayEntered === true
      ? ["dom", "screenshot"]
      : ["dom"];

  const shouldRequestRuntimeProbe =
    input.decisionActionId === "start-cpu-match" ||
    input.decisionActionId === "execute-planned-shot" ||
    input.decisionActionId === "wait-for-turn-resolution" ||
    input.snapshot?.semanticState.gameplayEntered === true ||
    input.snapshot?.semanticState.menuVisible === true;

  return {
    modes,
    ...(shouldRequestRuntimeProbe
      ? {
          runtimeProbe: {
            id: CAT_AND_DOG_RUNTIME_PROBE_ID,
            script: CAT_AND_DOG_RUNTIME_PROBE_SCRIPT
          }
        }
      : {})
  };
}

export function parseCatAndDogRuntimeState(frame: ObservationFrame): CatAndDogRuntimeState {
  const runtimeProbe = readNestedObject(frame.payload.runtimeProbe);
  if (!runtimeProbe || readString(runtimeProbe.id) !== CAT_AND_DOG_RUNTIME_PROBE_ID) {
    return {
      runtimeStateAvailable: false,
      runtimeStateSource: "unavailable",
      runtimeStateError: null,
      runtimeScene: null,
      runtimePhase: null,
      runtimeMode: null,
      currentPlayerIndex: null,
      currentPlayerName: null,
      cpuDifficulty: null,
      windValue: null,
      windNormalized: null,
      windDirection: "unknown",
      windMax: null,
      preparedShotAngle: null,
      preparedShotPower: null,
      preparedShotKey: null,
      preparedShotBossEcho: false,
      projectileLabel: null,
      projectileWeight: null,
      projectileLaunchSpeedMultiplier: null,
      projectileGravityMultiplier: null,
      projectileWindInfluenceMultiplier: null,
      projectileSplashRadius: null,
      projectileDamageMin: null,
      projectileDamageMax: null,
      projectileWindupSeconds: null
    };
  }

  const value = readNestedObject(runtimeProbe.value);
  const error = readString(runtimeProbe.error);
  const available = readBoolean(value?.available);
  const sourceRaw = readString(value?.source);
  const source: CatAndDogRuntimeState["runtimeStateSource"] =
    sourceRaw === "fixture-hook" || sourceRaw === "game-instance" || sourceRaw === "error"
      ? sourceRaw
      : available
        ? "game-instance"
        : error
          ? "error"
          : "unavailable";
  const preparedThrow = readNestedObject(value?.preparedThrow);
  const projectileConfig = readNestedObject(value?.projectileConfig);
  const windValue = readNumber(value?.windValue);
  const windMax = readNumber(value?.windMax);
  const windNormalized =
    windValue !== null && windMax !== null && windMax > 0
      ? Number((windValue / windMax).toFixed(3))
      : null;

  return {
    runtimeStateAvailable: available,
    runtimeStateSource: source,
    runtimeStateError: error,
    runtimeScene: readString(value?.scene),
    runtimePhase: readString(value?.phase),
    runtimeMode: readString(value?.mode),
    currentPlayerIndex: readNumber(value?.currentPlayerIndex),
    currentPlayerName: readString(value?.currentPlayerName),
    cpuDifficulty: readString(value?.cpuDifficulty),
    windValue,
    windNormalized,
    windDirection: toWindDirection(windValue),
    windMax,
    preparedShotAngle: readNumber(preparedThrow?.angle),
    preparedShotPower: readNumber(preparedThrow?.power),
    preparedShotKey: readString(preparedThrow?.shotKey),
    preparedShotBossEcho: readBoolean(preparedThrow?.bossEcho),
    projectileLabel: readString(projectileConfig?.label),
    projectileWeight: readNumber(projectileConfig?.weight),
    projectileLaunchSpeedMultiplier: readNumber(projectileConfig?.launchSpeedMultiplier),
    projectileGravityMultiplier: readNumber(projectileConfig?.gravityMultiplier),
    projectileWindInfluenceMultiplier: readNumber(projectileConfig?.windInfluenceMultiplier),
    projectileSplashRadius: readNumber(projectileConfig?.splashRadius),
    projectileDamageMin: readNumber(projectileConfig?.damageMin),
    projectileDamageMax: readNumber(projectileConfig?.damageMax),
    projectileWindupSeconds: readNumber(projectileConfig?.windup)
  };
}
