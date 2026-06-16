import type { GameManifest, GamePlugin, GameSession, GameSessionContext } from "@game-bots/game-sdk";

import { ChessComGameSession } from "./session.js";

const manifest: GameManifest = {
  gameId: "chess-com-web",
  displayName: "Chess.com Computer",
  version: "0.1.0"
};

export const chessComWebPlugin: GamePlugin = {
  manifest,
  async createSession(context: GameSessionContext): Promise<GameSession> {
    return new ChessComGameSession(context);
  }
};
