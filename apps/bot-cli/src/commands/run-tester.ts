import type { RunRequest } from "@game-bots/contracts";
import { createTesterBrain } from "@game-bots/agent-tester";
import { wordleWebPlugin } from "@game-bots/wordle-web";

import type { AppContainer } from "../bootstrap/container.js";

export async function runTester(container: AppContainer): Promise<void> {
  const plugin = wordleWebPlugin;
  const brain = createTesterBrain();

  const request: RunRequest = {
    agentKind: "tester",
    gameId: plugin.manifest.gameId,
    environmentId: container.config.runtime.defaultEnvironmentId,
    profileId: "wordle-web.tester.smoke",
    scenarioId: "smoke",
    config: {}
  };

  const run = await container.runEngine.createRun(request);
  await brain.initialize({ run });

  process.stdout.write(`Created tester run ${run.runId} for ${plugin.manifest.gameId}\n`);
}
