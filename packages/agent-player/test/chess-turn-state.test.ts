import { describe, expect, it } from "vitest";

import { inferChessTurnState } from "../src/domain/chess-turn-state.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";
const AFTER_BOT_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w - - 0 1";
const AFTER_COMPUTER_E6 = "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w - - 0 1";

describe("chess turn state inference", () => {
  it("treats an unchanged board after a bot move as waiting for opponent", () => {
    const state = inferChessTurnState({
      boardDetected: true,
      fen: AFTER_BOT_E4,
      sideToMove: null,
      botColor: "white",
      lastBotMoveFen: AFTER_BOT_E4,
      previousObservationFen: AFTER_BOT_E4
    });

    expect(state.botTurnStatus).toBe("opponent-turn");
    expect(state.confidence).toBe("medium");
    expect(state.reason).toMatch(/waiting for computer reply/i);
    expect(state.boardChangedSinceLastObservation).toBe(false);
  });

  it("infers bot turn after the board changes from the last bot move", () => {
    const state = inferChessTurnState({
      boardDetected: true,
      fen: AFTER_COMPUTER_E6,
      sideToMove: null,
      botColor: "white",
      lastBotMoveFen: AFTER_BOT_E4,
      previousObservationFen: AFTER_BOT_E4
    });

    expect(state.botTurnStatus).toBe("bot-turn");
    expect(state.confidence).toBe("medium");
    expect(state.reason).toMatch(/computer reply completed/i);
    expect(state.boardChangedSinceLastObservation).toBe(true);
  });

  it("uses explicit side-to-move when available", () => {
    const state = inferChessTurnState({
      boardDetected: true,
      fen: START,
      sideToMove: "white",
      botColor: "white",
      lastBotMoveFen: null
    });

    expect(state.botTurnStatus).toBe("bot-turn");
    expect(state.confidence).toBe("high");
  });

  it("does not report bot turn when explicit side-to-move is opponent", () => {
    const state = inferChessTurnState({
      boardDetected: true,
      fen: START.replace(" w ", " b "),
      sideToMove: "black",
      botColor: "white",
      lastBotMoveFen: null
    });

    expect(state.botTurnStatus).toBe("opponent-turn");
    expect(state.confidence).toBe("high");
  });

  it("stays unknown when the board is absent", () => {
    const state = inferChessTurnState({
      boardDetected: false,
      fen: null,
      sideToMove: null,
      botColor: "white",
      lastBotMoveFen: null
    });

    expect(state.botTurnStatus).toBe("unknown");
    expect(state.confidence).toBe("low");
  });
});
