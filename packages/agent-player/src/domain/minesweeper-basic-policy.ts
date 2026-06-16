export type MinesweeperPolicyCellState = "hidden" | "revealed" | "flagged" | "exploded" | "unknown";

export interface MinesweeperPolicyCell {
  readonly x: number;
  readonly y: number;
  readonly state: MinesweeperPolicyCellState;
  readonly adjacentMineCount: number | null;
}

export interface MinesweeperPolicyBoard {
  readonly width: number;
  readonly height: number;
  readonly mineCount?: number | null;
  readonly cells: readonly MinesweeperPolicyCell[];
}

export interface MinesweeperMoveChoice {
  readonly action: "reveal" | "flag" | "guess";
  readonly x: number;
  readonly y: number;
  readonly reason: string;
  readonly sourceCells: readonly { readonly x: number; readonly y: number }[];
  readonly safeMoveCount: number;
  readonly knownMineCount: number;
  readonly hiddenCount: number;
  readonly flaggedCount: number;
  readonly riskEstimate: number | null;
  readonly firstClick: boolean;
}

export interface MinesweeperBoardAnalysis {
  readonly safeCells: readonly MinesweeperPolicyCell[];
  readonly mineCells: readonly MinesweeperPolicyCell[];
  readonly hiddenCells: readonly MinesweeperPolicyCell[];
  readonly flaggedCells: readonly MinesweeperPolicyCell[];
  readonly revealedNumberCells: readonly MinesweeperPolicyCell[];
}

export function analyzeMinesweeperBoard(board: MinesweeperPolicyBoard): MinesweeperBoardAnalysis {
  const cells = board.cells.filter(isOnBoard(board));
  const byKey = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const safe = new Map<string, MinesweeperPolicyCell>();
  const mines = new Map<string, MinesweeperPolicyCell>();
  const revealedNumberCells = cells.filter(
    (cell) => cell.state === "revealed" && typeof cell.adjacentMineCount === "number" && cell.adjacentMineCount > 0
  );

  for (const cell of revealedNumberCells) {
    const neighbors = neighborCoordinates(cell.x, cell.y, board)
      .map((coord) => byKey.get(coordKey(coord.x, coord.y)))
      .filter((entry): entry is MinesweeperPolicyCell => entry !== undefined);
    const hiddenNeighbors = neighbors.filter((neighbor) => neighbor.state === "hidden");
    const flaggedNeighbors = neighbors.filter((neighbor) => neighbor.state === "flagged");
    const count = cell.adjacentMineCount ?? 0;

    if (hiddenNeighbors.length > 0 && flaggedNeighbors.length === count) {
      for (const hidden of hiddenNeighbors) {
        safe.set(cellKey(hidden), hidden);
      }
    }

    if (hiddenNeighbors.length > 0 && hiddenNeighbors.length + flaggedNeighbors.length === count) {
      for (const hidden of hiddenNeighbors) {
        mines.set(cellKey(hidden), hidden);
      }
    }
  }

  for (const key of mines.keys()) {
    safe.delete(key);
  }

  return {
    safeCells: [...safe.values()].sort(byReadingOrder),
    mineCells: [...mines.values()].sort(byReadingOrder),
    hiddenCells: cells.filter((cell) => cell.state === "hidden").sort(byReadingOrder),
    flaggedCells: cells.filter((cell) => cell.state === "flagged").sort(byReadingOrder),
    revealedNumberCells
  };
}

export function chooseMinesweeperMove(board: MinesweeperPolicyBoard): MinesweeperMoveChoice | null {
  const analysis = analyzeMinesweeperBoard(board);
  const hiddenCount = analysis.hiddenCells.length;
  const flaggedCount = analysis.flaggedCells.length;
  const firstClick = board.cells.every((cell) => cell.state === "hidden" || cell.state === "unknown");
  const sourceCells = analysis.revealedNumberCells.map((cell) => ({ x: cell.x, y: cell.y }));

  if (firstClick && analysis.hiddenCells.length > 0) {
    const center = pickCenterCell(board, analysis.hiddenCells);
    return {
      action: "guess",
      x: center.x,
      y: center.y,
      reason: "first-click center reveal; no visible numbers exist yet",
      sourceCells: [],
      safeMoveCount: 0,
      knownMineCount: 0,
      hiddenCount,
      flaggedCount,
      riskEstimate: estimateGlobalRisk(board, hiddenCount, flaggedCount),
      firstClick: true
    };
  }

  if (analysis.safeCells.length > 0) {
    const cell = analysis.safeCells[0]!;
    return {
      action: "reveal",
      x: cell.x,
      y: cell.y,
      reason: "a revealed number already has all adjacent mines flagged, so remaining hidden neighbors are safe",
      sourceCells,
      safeMoveCount: analysis.safeCells.length,
      knownMineCount: analysis.mineCells.length,
      hiddenCount,
      flaggedCount,
      riskEstimate: 0,
      firstClick: false
    };
  }

  if (analysis.mineCells.length > 0) {
    const cell = analysis.mineCells[0]!;
    return {
      action: "flag",
      x: cell.x,
      y: cell.y,
      reason: "a revealed number's hidden plus flagged neighbor count equals its mine count",
      sourceCells,
      safeMoveCount: 0,
      knownMineCount: analysis.mineCells.length,
      hiddenCount,
      flaggedCount,
      riskEstimate: 1,
      firstClick: false
    };
  }

  if (analysis.hiddenCells.length === 0) {
    return null;
  }

  const guess = pickLowestRiskGuess(board, analysis.hiddenCells);
  return {
    action: "guess",
    x: guess.x,
    y: guess.y,
    reason: "no deterministic Minesweeper deduction was available; choosing a bounded-risk hidden cell",
    sourceCells,
    safeMoveCount: 0,
    knownMineCount: 0,
    hiddenCount,
    flaggedCount,
    riskEstimate: estimateGlobalRisk(board, hiddenCount, flaggedCount),
    firstClick: false
  };
}

function pickCenterCell(board: MinesweeperPolicyBoard, hiddenCells: readonly MinesweeperPolicyCell[]): MinesweeperPolicyCell {
  const centerX = Math.ceil(board.width / 2);
  const centerY = Math.ceil(board.height / 2);
  return hiddenCells.find((cell) => cell.x === centerX && cell.y === centerY) ?? hiddenCells[0]!;
}

function pickLowestRiskGuess(
  board: MinesweeperPolicyBoard,
  hiddenCells: readonly MinesweeperPolicyCell[]
): MinesweeperPolicyCell {
  return [...hiddenCells].sort((left, right) => {
    const leftRisk = localRiskScore(board, left);
    const rightRisk = localRiskScore(board, right);
    return leftRisk - rightRisk || edgeScore(left, board) - edgeScore(right, board) || byReadingOrder(left, right);
  })[0]!;
}

function localRiskScore(board: MinesweeperPolicyBoard, cell: MinesweeperPolicyCell): number {
  const byKey = new Map(board.cells.map((entry) => [cellKey(entry), entry]));
  const numberNeighbors = neighborCoordinates(cell.x, cell.y, board)
    .map((coord) => byKey.get(coordKey(coord.x, coord.y)))
    .filter(
      (entry): entry is MinesweeperPolicyCell =>
        entry !== undefined && entry.state === "revealed" && typeof entry.adjacentMineCount === "number"
    );
  if (numberNeighbors.length === 0) {
    return 0.5;
  }
  return Math.max(
    ...numberNeighbors.map((neighbor) => {
      const neighbors = neighborCoordinates(neighbor.x, neighbor.y, board)
        .map((coord) => byKey.get(coordKey(coord.x, coord.y)))
        .filter((entry): entry is MinesweeperPolicyCell => entry !== undefined);
      const hidden = neighbors.filter((entry) => entry.state === "hidden").length;
      const flagged = neighbors.filter((entry) => entry.state === "flagged").length;
      return hidden > 0 ? Math.max(0, ((neighbor.adjacentMineCount ?? 0) - flagged) / hidden) : 1;
    })
  );
}

function edgeScore(cell: MinesweeperPolicyCell, board: MinesweeperPolicyBoard): number {
  const onEdge = cell.x === 1 || cell.y === 1 || cell.x === board.width || cell.y === board.height;
  const inCorner =
    (cell.x === 1 || cell.x === board.width) && (cell.y === 1 || cell.y === board.height);
  return inCorner ? 0 : onEdge ? 1 : 2;
}

function estimateGlobalRisk(board: MinesweeperPolicyBoard, hiddenCount: number, flaggedCount: number): number | null {
  if (!board.mineCount || hiddenCount <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, (board.mineCount - flaggedCount) / hiddenCount));
}

function neighborCoordinates(
  x: number,
  y: number,
  board: MinesweeperPolicyBoard
): readonly { readonly x: number; readonly y: number }[] {
  const coords: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX >= 1 && nextX <= board.width && nextY >= 1 && nextY <= board.height) {
        coords.push({ x: nextX, y: nextY });
      }
    }
  }
  return coords;
}

function isOnBoard(board: MinesweeperPolicyBoard): (cell: MinesweeperPolicyCell) => boolean {
  return (cell) => cell.x >= 1 && cell.x <= board.width && cell.y >= 1 && cell.y <= board.height;
}

function byReadingOrder(left: MinesweeperPolicyCell, right: MinesweeperPolicyCell): number {
  return left.y - right.y || left.x - right.x;
}

function cellKey(cell: MinesweeperPolicyCell): string {
  return coordKey(cell.x, cell.y);
}

function coordKey(x: number, y: number): string {
  return `${x},${y}`;
}
