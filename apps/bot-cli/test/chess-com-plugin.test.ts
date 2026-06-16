import { describe, expect, it } from "vitest";

import { chooseBeginnerChessMove, listLegalChessMoves } from "@game-bots/agent-player";
import { ChessComGameSession, parseChessComBoard, squareCenter } from "@game-bots/chess-com-web";

const STARTING_BOARD_HTML = `
  <wc-chess-board class="board">
    <div class="piece wr square-11"></div><div class="piece wn square-21"></div><div class="piece wb square-31"></div><div class="piece wq square-41"></div><div class="piece wk square-51"></div><div class="piece wb square-61"></div><div class="piece wn square-71"></div><div class="piece wr square-81"></div>
    <div class="piece wp square-12"></div><div class="piece wp square-22"></div><div class="piece wp square-32"></div><div class="piece wp square-42"></div><div class="piece wp square-52"></div><div class="piece wp square-62"></div><div class="piece wp square-72"></div><div class="piece wp square-82"></div>
    <div class="piece bp square-17"></div><div class="piece bp square-27"></div><div class="piece bp square-37"></div><div class="piece bp square-47"></div><div class="piece bp square-57"></div><div class="piece bp square-67"></div><div class="piece bp square-77"></div><div class="piece bp square-87"></div>
    <div class="piece br square-18"></div><div class="piece bn square-28"></div><div class="piece bb square-38"></div><div class="piece bq square-48"></div><div class="piece bk square-58"></div><div class="piece bb square-68"></div><div class="piece bn square-78"></div><div class="piece br square-88"></div>
  </wc-chess-board>
`;

describe("Chess.com plugin parser and basic policy", () => {
  it("parses Chess.com piece classes into FEN and chooses a safe opening move", () => {
    const board = parseChessComBoard({
      html: STARTING_BOARD_HTML,
      runtimeProbe: {
        url: "https://www.chess.com/play/computer",
        title: "Play Computer Chess Online",
        bodyText: "Play Computer",
        boardClassName: "board",
        boardBounds: { x: 80, y: 40, width: 640, height: 640 }
      }
    });

    expect(board.boardDetected).toBe(true);
    expect(board.unsafeHumanMatchmaking).toBe(false);
    expect(board.fen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");

    const move = chooseBeginnerChessMove({
      pieces: board.pieceMap,
      sideToMove: board.sideToMove,
      botColor: "white",
      fen: board.fen
    });

    expect(move?.lan).toBe("e2e4");
    expect(move?.legalMoveCount).toBeGreaterThan(0);
    expect(listLegalChessMoves(board.fen ?? "")).toContain(move?.lan);
    expect(move?.from).not.toBe("d1");
  });

  it("rejects illegal queen moves from the starting position", () => {
    const legalMoves = listLegalChessMoves("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");

    expect(legalMoves).toContain("e2e4");
    expect(legalMoves).not.toContain("d1h5");
  });

  it("maps algebraic squares to visible board centers by orientation", () => {
    const bounds = { x: 80, y: 40, width: 640, height: 640 };

    expect(squareCenter("a1", bounds, "white")).toEqual({ x: 120, y: 640 });
    expect(squareCenter("a1", bounds, "black")).toEqual({ x: 680, y: 80 });
  });

  it("rejects invalid move squares before sending board coordinates", async () => {
    const session = new ChessComGameSession();

    await expect(session.resolveAction({
      actionId: "execute-chess-move",
      params: {
        from: "d1",
        to: "h9",
        orientation: "white",
        boardBounds: { x: 80, y: 40, width: 640, height: 640 }
      }
    }, {
      title: "Chess.com Computer",
      isTerminal: false,
      semanticState: {},
      metrics: {}
    })).rejects.toThrow("Cannot resolve Chess.com board coordinates");
  });
});
