import { createContainer } from "./bootstrap/container.js";
import { rebuildReport } from "./commands/rebuild-report.js";
import { runPlayerChessCom } from "./commands/run-player-chess-com.js";
import { runPlayerCatAndDog } from "./commands/run-player-cat-and-dog.js";
import { runPlayer } from "./commands/run-player.js";
import { runTester } from "./commands/run-tester.js";

const CAT_AND_DOG_DIFFICULTIES = new Set(["easy", "normal", "hard", "impossible"]);

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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseHeadlessFlag(): boolean {
  if (hasFlag("--visible")) {
    return false;
  }

  return parseBooleanFlag("--headless", true);
}

function parseChessOpponentFlag(): "computer" {
  const raw = parseStringFlag("--opponent") ?? "computer";
  if (raw !== "computer") {
    throw new Error("run-player-chess-com only supports --opponent=computer. Human matchmaking is not allowed.");
  }
  return "computer";
}

function parseCatAndDogDifficultyFlag(): "easy" | "normal" | "hard" | "impossible" {
  const raw = parseStringFlag("--difficulty") ?? "easy";
  return CAT_AND_DOG_DIFFICULTIES.has(raw)
    ? (raw as "easy" | "normal" | "hard" | "impossible")
    : "easy";
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
        difficulty: parseCatAndDogDifficultyFlag(),
        maxAttempts: parseNumberFlag("--max-attempts", 3),
        stopOnWin: parseBooleanFlag("--stop-on-win", true),
        strategyMode: parseStringFlag("--strategy-mode") === "explore" ? "explore" : "baseline",
        headless: parseHeadlessFlag()
      });
      break;
    case "run-player-chess-com":
      await runPlayerChessCom(container, {
        opponent: parseChessOpponentFlag(),
        maxMoves: parseNumberFlag("--max-moves", 80),
        headless: parseHeadlessFlag(),
        turnTimeoutMs: parseNumberFlag("--turn-timeout-ms", 30000),
        pollMs: parseNumberFlag("--poll-ms", 750)
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
        "Usage: game-bots <run-player|run-player-cat-and-dog|run-player-chess-com|run-tester|run-tester-2048|run-tester-cat-and-dog|rebuild-report>\n" +
          "Cat-and-Dog player flags: --difficulty=easy|normal|hard|impossible --max-attempts=3 --strategy-mode=baseline|explore --stop-on-win=true|false --headless=true|false --visible\n" +
          "Chess.com player flags: --opponent=computer --max-moves=80 --turn-timeout-ms=30000 --poll-ms=750 --headless=true|false --visible\n"
      );
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
