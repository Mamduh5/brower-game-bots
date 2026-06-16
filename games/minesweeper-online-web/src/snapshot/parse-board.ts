import type { JsonObject } from "@game-bots/contracts";
import type { ObservationRequest } from "@game-bots/environment-sdk";

export type MinesweeperCellState = "hidden" | "revealed" | "flagged" | "exploded" | "unknown";
export type MinesweeperGameStatus = "loading" | "in-progress" | "win" | "loss" | "unknown";

export interface MinesweeperCell {
  readonly x: number;
  readonly y: number;
  readonly state: MinesweeperCellState;
  readonly adjacentMineCount: number | null;
  readonly screen: { readonly x: number; readonly y: number } | null;
  readonly className: string;
}

export interface MinesweeperBoardState {
  readonly boardDetected: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly difficulty: "beginner" | "unknown";
  readonly mineCount: number | null;
  readonly remainingMines: number | null;
  readonly revealedCount: number;
  readonly flaggedCount: number;
  readonly hiddenCount: number;
  readonly status: MinesweeperGameStatus;
  readonly faceClass: string | null;
  readonly boardBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly cellSize: number | null;
  readonly cells: readonly MinesweeperCell[];
}

export const MINESWEEPER_ONLINE_BOARD_RUNTIME_PROBE: NonNullable<ObservationRequest["runtimeProbe"]> = {
  id: "minesweeper-online-board-state",
  script: `
return (() => {
  const squares = [...document.querySelectorAll('div.square[id]')].map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      id: element.id,
      className: element.className,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  });
  const readDigit = (id) => {
    const element = document.getElementById(id);
    const match = element?.className?.match(/time(\\d)/);
    return match ? Number(match[1]) : null;
  };
  const digits = [readDigit('mines_hundreds'), readDigit('mines_tens'), readDigit('mines_ones')];
  const remainingMines = digits.every((digit) => digit !== null)
    ? digits[0] * 100 + digits[1] * 10 + digits[2]
    : null;
  const face = document.querySelector('#face');
  return {
    squares,
    remainingMines,
    faceClass: face?.className ?? null,
    bodyText: document.body?.innerText?.slice(0, 2000) ?? ''
  };
})();`
};

interface ParseInput {
  readonly runtimeProbe?: unknown;
}

export function parseMinesweeperOnlineBoard(input: ParseInput): MinesweeperBoardState {
  const runtime = asRecord(input.runtimeProbe);
  const rawSquares = arrayAt(runtime, "squares").map(asRecord);
  const parsedSquares = rawSquares
    .map((square) => {
      const parsedId = parseCellId(readString(square, "id"));
      if (!parsedId) {
        return null;
      }
      return {
        row: parsedId.row,
        col: parsedId.col,
        className: readString(square, "className") ?? "",
        x: readNumber(square, "x"),
        y: readNumber(square, "y"),
        width: readNumber(square, "width"),
        height: readNumber(square, "height")
      };
    })
    .filter((cell): cell is NonNullable<typeof cell> => cell !== null);

  if (parsedSquares.length === 0) {
    return emptyBoard("loading");
  }

  const hasBorder = parsedSquares.some((cell) => cell.row === 0 || cell.col === 0);
  const maxRow = Math.max(...parsedSquares.map((cell) => cell.row));
  const maxCol = Math.max(...parsedSquares.map((cell) => cell.col));
  const minPlayableRow = hasBorder ? 1 : Math.min(...parsedSquares.map((cell) => cell.row));
  const minPlayableCol = hasBorder ? 1 : Math.min(...parsedSquares.map((cell) => cell.col));
  const maxPlayableRow = hasBorder ? maxRow - 1 : maxRow;
  const maxPlayableCol = hasBorder ? maxCol - 1 : maxCol;
  const playable = parsedSquares.filter(
    (cell) =>
      cell.row >= minPlayableRow &&
      cell.row <= maxPlayableRow &&
      cell.col >= minPlayableCol &&
      cell.col <= maxPlayableCol
  );

  const cells = playable.map((cell) => {
    const state = cellStateFromClass(cell.className);
    const adjacentMineCount = adjacentMineCountFromClass(cell.className);
    return {
      x: cell.col - minPlayableCol + 1,
      y: cell.row - minPlayableRow + 1,
      state,
      adjacentMineCount,
      screen:
        cell.x !== null && cell.y !== null && cell.width !== null && cell.height !== null
          ? {
              x: cell.x + cell.width / 2,
              y: cell.y + cell.height / 2
            }
          : null,
      className: cell.className
    };
  });

  const bounds = boundsFromCells(playable);
  const faceClass = readString(runtime, "faceClass");
  const status = statusFromRuntime(faceClass, readString(runtime, "bodyText"), cells);
  const width = maxPlayableCol - minPlayableCol + 1;
  const height = maxPlayableRow - minPlayableRow + 1;

  return {
    boardDetected: cells.length > 0,
    width,
    height,
    difficulty: width === 9 && height === 9 ? "beginner" : "unknown",
    mineCount: width === 9 && height === 9 ? 10 : null,
    remainingMines: readNumber(runtime, "remainingMines"),
    revealedCount: cells.filter((cell) => cell.state === "revealed").length,
    flaggedCount: cells.filter((cell) => cell.state === "flagged").length,
    hiddenCount: cells.filter((cell) => cell.state === "hidden").length,
    status,
    faceClass,
    boardBounds: bounds,
    cellSize: estimateCellSize(playable),
    cells
  };
}

export function minesweeperBoardHash(board: MinesweeperBoardState): string | null {
  if (!board.boardDetected) {
    return null;
  }
  return board.cells
    .map((cell) => `${cell.x},${cell.y}:${cell.state}:${cell.adjacentMineCount ?? ""}`)
    .join("|");
}

function emptyBoard(status: MinesweeperGameStatus): MinesweeperBoardState {
  return {
    boardDetected: false,
    width: null,
    height: null,
    difficulty: "unknown",
    mineCount: null,
    remainingMines: null,
    revealedCount: 0,
    flaggedCount: 0,
    hiddenCount: 0,
    status,
    faceClass: null,
    boardBounds: null,
    cellSize: null,
    cells: []
  };
}

function parseCellId(id: string | null): { readonly row: number; readonly col: number } | null {
  const match = id?.match(/^(\d+)_(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    row: Number(match[1]),
    col: Number(match[2])
  };
}

function cellStateFromClass(className: string): MinesweeperCellState {
  if (/\bbombflagged\b/.test(className)) {
    return "flagged";
  }
  if (/\bbombdeath\b|\bbombrevealed\b|\bbombmisflagged\b/.test(className)) {
    return "exploded";
  }
  if (/\bopen[0-8]\b/.test(className)) {
    return "revealed";
  }
  if (/\bblank\b/.test(className)) {
    return "hidden";
  }
  return "unknown";
}

function adjacentMineCountFromClass(className: string): number | null {
  const match = className.match(/\bopen([0-8])\b/);
  return match ? Number(match[1]) : null;
}

function statusFromRuntime(
  faceClass: string | null,
  bodyText: string | null,
  cells: readonly MinesweeperCell[]
): MinesweeperGameStatus {
  if (faceClass?.includes("facedead") || cells.some((cell) => cell.className.includes("bombdeath"))) {
    return "loss";
  }
  if (faceClass?.includes("facewin") || /\bcongratulations\b/i.test(bodyText ?? "")) {
    return "win";
  }
  return cells.length > 0 ? "in-progress" : "unknown";
}

function boundsFromCells(
  cells: readonly { readonly x: number | null; readonly y: number | null; readonly width: number | null; readonly height: number | null }[]
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null {
  const rects = cells.filter(
    (cell) => cell.x !== null && cell.y !== null && cell.width !== null && cell.height !== null
  ) as readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
  if (rects.length === 0) {
    return null;
  }
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function estimateCellSize(
  cells: readonly { readonly width: number | null; readonly height: number | null }[]
): number | null {
  const sizes = cells
    .flatMap((cell) => [cell.width, cell.height])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (sizes.length === 0) {
    return null;
  }
  return Math.round(sizes.reduce((total, value) => total + value, 0) / sizes.length);
}

function asRecord(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function arrayAt(record: JsonObject, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readString(record: JsonObject, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(record: JsonObject, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
