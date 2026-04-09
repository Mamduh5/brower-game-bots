import { createContainer } from "./bootstrap/container.js";
import { rebuildReport } from "./commands/rebuild-report.js";
import { runPlayer } from "./commands/run-player.js";
import { runTester } from "./commands/run-tester.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  const container = await createContainer();

  switch (command) {
    case "run-player":
      await runPlayer(container);
      break;
    case "run-tester":
      await runTester(container);
      break;
    case "rebuild-report":
      await rebuildReport();
      break;
    default:
      process.stdout.write("Usage: game-bots <run-player|run-tester|rebuild-report>\n");
  }
}

void main();
