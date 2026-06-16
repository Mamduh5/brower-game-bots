import { Chess, type Move } from "chess.js";

export type ChessColor = "white" | "black";
export type ChessPieceKind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type ChessSquare = `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

export interface ChessPiece {
  readonly color: ChessColor;
  readonly kind: ChessPieceKind;
}

export interface ChessBoardState {
  readonly pieces: Readonly<Record<string, ChessPiece>>;
  readonly sideToMove: ChessColor | null;
  readonly botColor: ChessColor;
  readonly fen: string | null;
}

export interface ChessMoveChoice {
  readonly from: ChessSquare;
  readonly to: ChessSquare;
  readonly lan: string;
  readonly san: string;
  readonly reason: string;
  readonly legalMoveCount: number;
}

const WHITE_PRIORITIES: readonly string[] = ["e2e4", "d2d4", "g1f3", "c2c4"];
const BLACK_PRIORITIES: readonly string[] = ["e7e5", "d7d5", "g8f6", "c7c5"];

export function chooseBeginnerChessMove(board: ChessBoardState): ChessMoveChoice | null {
  if (!board.fen || !board.sideToMove || board.sideToMove !== board.botColor) {
    return null;
  }

  let chess: Chess;
  try {
    chess = new Chess(board.fen);
  } catch {
    return null;
  }

  const legalMoves = chess.moves({ verbose: true });
  const priorities = board.sideToMove === "white" ? WHITE_PRIORITIES : BLACK_PRIORITIES;
  const selected =
    priorities.map((lan) => legalMoves.find((move) => moveToLan(move) === lan)).find((move): move is Move => Boolean(move)) ??
    legalMoves[0] ??
    null;

  if (!selected || !isChessSquare(selected.from) || !isChessSquare(selected.to)) {
    return null;
  }

  return {
    from: selected.from,
    to: selected.to,
    lan: moveToLan(selected),
    san: selected.san,
    reason: priorities.includes(moveToLan(selected))
      ? "Preferred deterministic legal beginner move from chess.js legal move list."
      : "First legal move from chess.js legal move list.",
    legalMoveCount: legalMoves.length
  };
}

export function listLegalChessMoves(fen: string): readonly string[] {
  try {
    return new Chess(fen).moves({ verbose: true }).map(moveToLan);
  } catch {
    return [];
  }
}

function moveToLan(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function isChessSquare(value: string): value is ChessSquare {
  return /^[a-h][1-8]$/.test(value);
}
