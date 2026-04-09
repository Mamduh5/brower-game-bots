import type { GamePlugin } from "@game-bots/game-sdk";

export async function assertGamePluginContract(plugin: GamePlugin): Promise<void> {
  const session = await plugin.createSession({});
  await session.scenarios();
  await session.evaluators();
}
