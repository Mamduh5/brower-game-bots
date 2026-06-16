import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";

import {
  CHESS_PIECE_VALUES,
  chooseBeginnerChessMove,
  evaluateChessPosition,
  evaluateMaterialBalance,
  listLegalChessMoves,
  type ChessBoardState,
  type ChessColor
} from "../src/domain/chess-basic-policy.js";

function board(fen: string, botColor: ChessColor = fen.includes(" b ") ? "black" : "white"): ChessBoardState {
  return {
    pieces: {},
    sideToMove: botColor,
    botColor,
    fen
  };
}

describe("chess basic policy", () => {
  it("chooses a legal opening move with center or development reasoning from the starting position", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";
    const move = chooseBeginnerChessMove(board(fen));

    expect(move?.legalMoveCount).toBe(20);
    expect(move?.lan).toBeTruthy();
    expect(listLegalChessMoves(fen)).toContain(move?.lan);
    expect(move?.from).not.toBe("d1");
    expect(move?.reason).toMatch(/center|develop|opening/i);
  });

  it("selects a mate-in-one move when available", () => {
    const move = chooseBeginnerChessMove(board("7k/8/5KQ1/8/8/8/8/8 w - - 0 1"));

    expect(move?.lan).toBe("g6g7");
    expect(move?.san).toContain("#");
    expect(move?.reason).toBe("checkmate available");
  });

  it("prefers a free queen capture over quiet moves", () => {
    const move = chooseBeginnerChessMove(board("q3k3/8/8/8/8/8/8/R3K3 w - - 0 1"));

    expect(move?.lan).toBe("a1a8");
    expect(move?.captured).toBe("queen");
    expect(move?.reason).toBe("wins queen");
  });

  it("avoids an immediately capturable queen move when a safe alternative exists", () => {
    const fen = "4k2r/8/8/7p/8/8/8/3QK3 w - - 0 1";
    const evaluation = evaluateChessPosition(board(fen));
    const queenBlunder = evaluation?.candidates.find((candidate) => candidate.lan === "d1h5");

    expect(queenBlunder).toBeTruthy();
    expect(evaluation?.candidates[0]?.lan).not.toBe("d1h5");
    expect((evaluation?.candidates[0]?.score ?? 0)).toBeGreaterThan(queenBlunder?.score ?? 0);
  });

  it("values material in queen, rook, minor, pawn order", () => {
    expect(CHESS_PIECE_VALUES.queen).toBeGreaterThan(CHESS_PIECE_VALUES.rook);
    expect(CHESS_PIECE_VALUES.rook).toBeGreaterThan(CHESS_PIECE_VALUES.bishop);
    expect(CHESS_PIECE_VALUES.bishop).toBeGreaterThan(CHESS_PIECE_VALUES.pawn);
    expect(CHESS_PIECE_VALUES.knight).toBeGreaterThan(CHESS_PIECE_VALUES.pawn);
    expect(evaluateMaterialBalance("4k3/8/8/8/8/8/8/4KQ1r w - - 0 1", "white")).toBe(400);
  });

  it("selects a legal move that resolves check", () => {
    const fen = "4k3/8/8/8/8/8/4q3/4K2Q w - - 0 1";
    const move = chooseBeginnerChessMove(board(fen));
    const chess = new Chess(fen);

    expect(chess.isCheck()).toBe(true);
    expect(move?.lan).toBe("e1e2");
    expect(move?.inCheck).toBe(true);
    expect(move?.checkEvasionRequired).toBe(true);
    expect(move?.checkEvasionMoveType).toBe("king-move");
    expect(move?.reason).toMatch(/check/i);
    chess.move({ from: move?.from ?? "", to: move?.to ?? "", promotion: move?.promotion ?? undefined });
    expect(chess.isCheck()).toBe(false);
  });

  it("prefers queen promotion when promotion is available", () => {
    const move = chooseBeginnerChessMove(board("4k3/P7/8/8/8/8/8/4K3 w - - 0 1"));

    expect(move?.lan).toBe("a7a8q");
    expect(move?.uci).toBe("a7a8q");
    expect(move?.promotion).toBe("queen");
    expect(move?.promotionPiece).toBe("queen");
    expect(move?.reason).toBe("promotes to queen");
  });

  it("detects checkmate positions with no legal evasion", () => {
    const evaluation = evaluateChessPosition(board("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", "black"));

    expect(evaluation?.inCheck).toBe(true);
    expect(evaluation?.isCheckmate).toBe(true);
    expect(evaluation?.legalMoveCount).toBe(0);
    expect(evaluation?.candidates).toHaveLength(0);
  });
});
