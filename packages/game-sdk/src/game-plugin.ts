import { z } from "zod";

import { GameIdSchema } from "@game-bots/contracts";

import type { GameSession } from "./game-session.js";

export const GameManifestSchema = z.object({
  gameId: GameIdSchema,
  displayName: z.string().min(1),
  version: z.string().min(1)
});
export type GameManifest = z.infer<typeof GameManifestSchema>;

export interface GameSessionContext {
  profileId?: string;
}

export interface GamePlugin {
  readonly manifest: GameManifest;
  createSession(context: GameSessionContext): Promise<GameSession>;
}
