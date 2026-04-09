import type { GamePlugin } from "@game-bots/game-sdk";
import { catAndDogWebPlugin } from "@game-bots/cat-and-dog-web";
import { play2048WebPlugin } from "@game-bots/play2048-web";
import { wordleWebPlugin } from "@game-bots/wordle-web";

export interface TesterDefaults {
  profileId: string;
  scenarioId: string;
}

const gamePlugins = new Map<string, GamePlugin>([
  [wordleWebPlugin.manifest.gameId, wordleWebPlugin],
  [catAndDogWebPlugin.manifest.gameId, catAndDogWebPlugin],
  [play2048WebPlugin.manifest.gameId, play2048WebPlugin]
]);

const testerDefaultsByGame = new Map<string, TesterDefaults>([
  [
    wordleWebPlugin.manifest.gameId,
    {
      profileId: "wordle-web.tester.smoke",
      scenarioId: "smoke"
    }
  ],
  [
    catAndDogWebPlugin.manifest.gameId,
    {
      profileId: "cat-and-dog-web.tester.smoke",
      scenarioId: "smoke"
    }
  ],
  [
    play2048WebPlugin.manifest.gameId,
    {
      profileId: "play2048-web.tester.smoke",
      scenarioId: "smoke"
    }
  ]
]);

export function resolveGamePlugin(gameId: string): GamePlugin {
  const plugin = gamePlugins.get(gameId);
  if (!plugin) {
    const available = [...gamePlugins.keys()].sort().join(", ");
    throw new Error(`Unsupported gameId '${gameId}'. Available gameIds: ${available}.`);
  }

  return plugin;
}

export function resolveTesterDefaults(gameId: string): TesterDefaults {
  const defaults = testerDefaultsByGame.get(gameId);
  if (!defaults) {
    const available = [...testerDefaultsByGame.keys()].sort().join(", ");
    throw new Error(`No tester defaults configured for gameId '${gameId}'. Available gameIds: ${available}.`);
  }

  return defaults;
}
