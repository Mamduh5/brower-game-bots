import type { GameManifest, GamePlugin, GameSession, GameSessionContext } from "@game-bots/game-sdk";

import { Play2048GameSession } from "./session.js";

const manifest: GameManifest = {
  gameId: "play2048-web",
  displayName: "Play2048 Web",
  version: "0.1.0"
};

export const play2048WebPlugin: GamePlugin = {
  manifest,
  async createSession(_context: GameSessionContext): Promise<GameSession> {
    return new Play2048GameSession();
  }
};
