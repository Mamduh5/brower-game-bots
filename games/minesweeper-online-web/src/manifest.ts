import type { GamePlugin } from "@game-bots/game-sdk";

import { MinesweeperOnlineGameSession } from "./session.js";

export const minesweeperOnlineWebPlugin: GamePlugin = {
  manifest: {
    gameId: "minesweeper-online-web",
    displayName: "Minesweeper Online",
    version: "0.1.0"
  },
  async createSession(context) {
    return new MinesweeperOnlineGameSession(context);
  }
};
