import { createContainer } from "./bootstrap/container.js";
import { rebuildReport } from "./commands/rebuild-report.js";
import { runPlayerCatAndDog } from "./commands/run-player-cat-and-dog.js";
import { runPlayer } from "./commands/run-player.js";
import { runTester } from "./commands/run-tester.js";

function parseNumberFlag(flag: string, fallback: number): number {
  const raw = process.argv.find((entry) => entry.startsWith(`${flag}=`));
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw.slice(flag.length + 1));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStringFlag(flag: string): string | null {
  const raw = process.argv.find((entry) => entry.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1) : null;
}

function parseBooleanFlag(flag: string, fallback: boolean): boolean {
  const raw = parseStringFlag(flag);
  if (raw === null) {
    return fallback;
  }

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  return fallback;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const container = await createContainer();

  switch (command) {
    case "run-player":
      await runPlayer(container);
      break;
    case "run-player-cat-and-dog":
      await runPlayerCatAndDog(container, {
        maxAttempts: parseNumberFlag("--max-attempts", 3),
        stopOnWin: parseBooleanFlag("--stop-on-win", true),
        strategyMode: parseStringFlag("--strategy-mode") === "explore" ? "explore" : "baseline"
      });
      break;
    case "run-tester":
      await runTester(container);
      break;
    case "run-tester-2048":
      await runTester(container, {
        gameId: "play2048-web",
        profileId: "play2048-web.tester.smoke",
        scenarioId: "smoke"
      });
      break;
    case "run-tester-cat-and-dog":
      await runTester(container, {
        gameId: "cat-and-dog-web",
        profileId: "cat-and-dog-web.tester.smoke",
        scenarioId: "smoke"
      });
      break;
    case "rebuild-report":
      await rebuildReport();
      break;
    default:
      process.stdout.write(
        "Usage: game-bots <run-player|run-player-cat-and-dog|run-tester|run-tester-2048|run-tester-cat-and-dog|rebuild-report>\n"
      );
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
