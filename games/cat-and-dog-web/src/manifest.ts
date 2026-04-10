import type { GameManifest, GamePlugin, GameSession, GameSessionContext } from "@game-bots/game-sdk";

import { CatAndDogGameSession } from "./session.js";

const manifest: GameManifest = {
  gameId: "cat-and-dog-web",
  displayName: "Cat and Dog Web",
  version: "0.1.0"
};

export const catAndDogWebPlugin: GamePlugin = {
  manifest,
  async createSession(context: GameSessionContext): Promise<GameSession> {
    return new CatAndDogGameSession(context);
  }
};
