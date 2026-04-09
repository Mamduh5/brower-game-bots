import type { GameManifest, GamePlugin, GameSession, GameSessionContext } from "@game-bots/game-sdk";

import { WordleGameSession } from "./session.js";

const manifest: GameManifest = {
  gameId: "wordle-web",
  displayName: "Wordle Web",
  version: "0.1.0"
};

export const wordleWebPlugin: GamePlugin = {
  manifest,
  async createSession(_context: GameSessionContext): Promise<GameSession> {
    return new WordleGameSession();
  }
};
