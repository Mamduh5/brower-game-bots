import type { RunRequest } from "@game-bots/contracts";
import { createPlayerBrain } from "@game-bots/agent-player";
import { wordleWebPlugin } from "@game-bots/wordle-web";

import type { AppContainer } from "../bootstrap/container.js";

export async function runPlayer(container: AppContainer): Promise<void> {
  const plugin = wordleWebPlugin;
  const brain = createPlayerBrain();

  const request: RunRequest = {
    agentKind: "player",
    gameId: plugin.manifest.gameId,
    environmentId: container.config.runtime.defaultEnvironmentId,
    profileId: "wordle-web.player.default",
    config: {}
  };

  const run = await container.runEngine.createRun(request);
  await brain.initialize({ run });

  process.stdout.write(`Created player run ${run.runId} for ${plugin.manifest.gameId}\n`);
}
