import type { EnvironmentAction, EnvironmentSession, ObservationFrame } from "@game-bots/environment-sdk";
import type { GameActionRequest, GameActionSpec, GameSession, GameSnapshot, TestScenario } from "@game-bots/game-sdk";
import type { Evaluator } from "@game-bots/runtime-core";

import { MINESWEEPER_ONLINE_SELECTORS } from "./selectors.js";
import { parseMinesweeperOnlineBoard } from "./snapshot/parse-board.js";

const REVEAL_CELL_ACTION: GameActionSpec = {
  actionId: "reveal-cell",
  description: "Reveal one visible Minesweeper cell by left-clicking it."
};

const FLAG_CELL_ACTION: GameActionSpec = {
  actionId: "flag-cell",
  description: "Flag one visible Minesweeper cell by right-clicking it."
};

const WAIT_FOR_BOARD_ACTION: GameActionSpec = {
  actionId: "wait-for-board",
  description: "Wait briefly for the Minesweeper board to settle."
};

function resolveMinesweeperOnlineUrl(): string {
  const raw = (process.env.GAME_BOTS_MINESWEEPER_ONLINE_URL ?? MINESWEEPER_ONLINE_SELECTORS.defaultUrl).trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported GAME_BOTS_MINESWEEPER_ONLINE_URL protocol '${parsed.protocol}'.`);
  }
  return parsed.toString();
}

export class MinesweeperOnlineGameSession implements GameSession {
  constructor(private readonly context: { readonly profileId?: string } = {}) {}

  async bootstrap(environment: EnvironmentSession): Promise<void> {
    void this.context;
    await environment.execute({
      kind: "navigate",
      url: resolveMinesweeperOnlineUrl()
    });
    await environment.execute({ kind: "wait", durationMs: 1000 });
    await environment.execute({
      kind: "click-if-visible",
      target: {
        selector: MINESWEEPER_ONLINE_SELECTORS.optionsLink
      }
    });
    await environment.execute({ kind: "wait", durationMs: 250 });
    await environment.execute({
      kind: "click-if-visible",
      target: {
        selector: MINESWEEPER_ONLINE_SELECTORS.beginnerRadio
      }
    });
    await environment.execute({ kind: "wait", durationMs: 100 });
    await environment.execute({
      kind: "click-if-visible",
      target: {
        selector: MINESWEEPER_ONLINE_SELECTORS.optionsSubmit
      }
    });
    await environment.execute({ kind: "wait", durationMs: 700 });
  }

  async translate(frame: ObservationFrame): Promise<GameSnapshot> {
    const runtimeProbe = frame.payload.runtimeProbe;
    const runtimeValue =
      runtimeProbe && typeof runtimeProbe === "object" && "value" in runtimeProbe
        ? (runtimeProbe as { value?: unknown }).value
        : null;
    const board = parseMinesweeperOnlineBoard({
      runtimeProbe: runtimeValue
    });

    return {
      title: "Minesweeper Online",
      isTerminal: board.status === "win" || board.status === "loss",
      semanticState: {
        status: board.status,
        boardDetected: board.boardDetected,
        difficulty: board.difficulty,
        width: board.width,
        height: board.height,
        mineCount: board.mineCount,
        remainingMines: board.remainingMines,
        revealedCount: board.revealedCount,
        flaggedCount: board.flaggedCount,
        hiddenCount: board.hiddenCount,
        faceClass: board.faceClass,
        boardBounds: board.boardBounds ? { ...board.boardBounds } : null,
        cellSize: board.cellSize,
        cells: board.cells.map((cell) => ({ ...cell, screen: cell.screen ? { ...cell.screen } : null }))
      },
      metrics: {
        revealedCount: board.revealedCount,
        flaggedCount: board.flaggedCount,
        hiddenCount: board.hiddenCount
      }
    };
  }

  async actions(): Promise<readonly GameActionSpec[]> {
    return [REVEAL_CELL_ACTION, FLAG_CELL_ACTION, WAIT_FOR_BOARD_ACTION];
  }

  async resolveAction(request: GameActionRequest, snapshot: GameSnapshot): Promise<readonly EnvironmentAction[]> {
    if (request.actionId === WAIT_FOR_BOARD_ACTION.actionId) {
      return [{ kind: "wait", durationMs: readNumberParam(request.params, "durationMs", 350) }];
    }

    if (request.actionId !== REVEAL_CELL_ACTION.actionId && request.actionId !== FLAG_CELL_ACTION.actionId) {
      throw new Error(`Unsupported Minesweeper Online action '${request.actionId}'.`);
    }

    const x = readNumberParam(request.params, "x", NaN);
    const y = readNumberParam(request.params, "y", NaN);
    const point = cellPointFromSnapshot(snapshot, x, y);
    if (!point) {
      throw new Error(`Cannot resolve Minesweeper cell coordinates for ${x},${y}.`);
    }

    return [
      {
        kind: "mouse-click",
        point,
        ...(request.actionId === FLAG_CELL_ACTION.actionId ? { button: "right" as const } : {})
      },
      {
        kind: "wait",
        durationMs: request.actionId === FLAG_CELL_ACTION.actionId ? 200 : 450
      }
    ];
  }

  async scenarios(): Promise<readonly TestScenario[]> {
    return [];
  }

  async evaluators(): Promise<readonly Evaluator[]> {
    return [];
  }
}

function cellPointFromSnapshot(
  snapshot: GameSnapshot,
  x: number,
  y: number
): { readonly x: number; readonly y: number } | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }
  const cells = Array.isArray(snapshot.semanticState.cells) ? snapshot.semanticState.cells : [];
  for (const entry of cells) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const cell = entry as Record<string, unknown>;
    const screen = cell.screen;
    const screenRecord = screen as Record<string, unknown>;
    if (
      cell.x === x &&
      cell.y === y &&
      screen &&
      typeof screen === "object" &&
      !Array.isArray(screen) &&
      typeof screenRecord.x === "number" &&
      typeof screenRecord.y === "number"
    ) {
      return {
        x: screenRecord.x,
        y: screenRecord.y
      };
    }
  }
  return null;
}

function readNumberParam(params: GameActionRequest["params"], key: string, fallback: number): number {
  const value = params?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
