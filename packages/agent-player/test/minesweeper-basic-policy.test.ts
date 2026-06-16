import { describe, expect, it } from "vitest";

import {
  analyzeMinesweeperBoard,
  chooseMinesweeperMove,
  type MinesweeperPolicyBoard,
  type MinesweeperPolicyCell
} from "../src/domain/minesweeper-basic-policy.js";

describe("minesweeper-basic-policy", () => {
  it("reveals hidden neighbors when a number already has enough flags", () => {
    const board = boardFromCells([
      number(2, 2, 1),
      flag(1, 1),
      hidden(2, 1),
      hidden(3, 1)
    ]);

    const choice = chooseMinesweeperMove(board);

    expect(choice).toMatchObject({
      action: "reveal",
      y: 1,
      riskEstimate: 0
    });
  });

  it("flags hidden neighbors when hidden plus flagged count equals the number", () => {
    const board = boardFromCells([
      number(2, 2, 2),
      flag(1, 1),
      hidden(2, 1),
      revealed(3, 1)
    ]);

    const analysis = analyzeMinesweeperBoard(board);
    const choice = chooseMinesweeperMove(board);

    expect(analysis.mineCells).toEqual([expect.objectContaining({ x: 2, y: 1 })]);
    expect(choice).toMatchObject({
      action: "flag",
      x: 2,
      y: 1
    });
  });

  it("does not expose a cell as safe when another deduction marks it as a mine", () => {
    const board = boardFromCells([
      number(2, 2, 1),
      flag(1, 1),
      hidden(2, 1),
      number(3, 2, 1)
    ]);

    const analysis = analyzeMinesweeperBoard(board);

    expect(analysis.mineCells).toEqual([expect.objectContaining({ x: 2, y: 1 })]);
    expect(analysis.safeCells).not.toContainEqual(expect.objectContaining({ x: 2, y: 1 }));
  });

  it("marks the initial center reveal as a guess", () => {
    const cells: MinesweeperPolicyCell[] = [];
    for (let y = 1; y <= 9; y += 1) {
      for (let x = 1; x <= 9; x += 1) {
        cells.push(hidden(x, y));
      }
    }

    const choice = chooseMinesweeperMove({ width: 9, height: 9, mineCount: 10, cells });

    expect(choice).toMatchObject({
      action: "guess",
      x: 5,
      y: 5,
      firstClick: true
    });
  });

  it("records bounded-risk guesses when deterministic logic is stuck", () => {
    const board = boardFromCells([
      number(2, 2, 1),
      hidden(1, 1),
      hidden(2, 1),
      revealed(3, 3)
    ]);

    const choice = chooseMinesweeperMove(board);

    expect(choice).toMatchObject({
      action: "guess",
      firstClick: false
    });
    expect(choice?.riskEstimate).toBeGreaterThan(0);
  });
});

function boardFromCells(cells: readonly MinesweeperPolicyCell[]): MinesweeperPolicyBoard {
  return {
    width: 3,
    height: 3,
    mineCount: 2,
    cells
  };
}

function number(x: number, y: number, adjacentMineCount: number): MinesweeperPolicyCell {
  return {
    x,
    y,
    state: "revealed",
    adjacentMineCount
  };
}

function hidden(x: number, y: number): MinesweeperPolicyCell {
  return {
    x,
    y,
    state: "hidden",
    adjacentMineCount: null
  };
}

function flag(x: number, y: number): MinesweeperPolicyCell {
  return {
    x,
    y,
    state: "flagged",
    adjacentMineCount: null
  };
}

function revealed(x: number, y: number): MinesweeperPolicyCell {
  return {
    x,
    y,
    state: "revealed",
    adjacentMineCount: 0
  };
}
