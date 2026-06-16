import type { ChessColor } from "./chess-basic-policy.js";

export type ChessBotTurnStatus = "bot-turn" | "opponent-turn" | "unknown";
export type ChessTurnConfidence = "high" | "medium" | "low";

export interface ChessTurnStateInput {
  readonly boardDetected: boolean;
  readonly fen: string | null;
  readonly sideToMove: ChessColor | null;
  readonly botColor: ChessColor;
  readonly lastBotMoveFen: string | null;
  readonly previousObservationFen?: string | null;
  readonly outcome?: string | null;
}

export interface ChessTurnState {
  readonly botTurnStatus: ChessBotTurnStatus;
  readonly confidence: ChessTurnConfidence;
  readonly reason: string;
  readonly boardHash: string | null;
  readonly boardChangedSinceLastObservation: boolean;
}

export function inferChessTurnState(input: ChessTurnStateInput): ChessTurnState {
  const boardHash = boardHashFromFen(input.fen);
  const previousBoardHash = boardHashFromFen(input.previousObservationFen ?? null);
  const lastBotMoveHash = boardHashFromFen(input.lastBotMoveFen);
  const boardChangedSinceLastObservation = Boolean(boardHash && previousBoardHash && boardHash !== previousBoardHash);

  if (input.outcome) {
    return {
      botTurnStatus: "unknown",
      confidence: "high",
      reason: `game ended: ${input.outcome}`,
      boardHash,
      boardChangedSinceLastObservation
    };
  }

  if (!input.boardDetected || !input.fen || !boardHash) {
    return {
      botTurnStatus: "unknown",
      confidence: "low",
      reason: "board not detected",
      boardHash,
      boardChangedSinceLastObservation
    };
  }

  if (input.sideToMove) {
    return {
      botTurnStatus: input.sideToMove === input.botColor ? "bot-turn" : "opponent-turn",
      confidence: "high",
      reason: input.sideToMove === input.botColor ? "side-to-move matches bot color" : "side-to-move belongs to opponent",
      boardHash,
      boardChangedSinceLastObservation
    };
  }

  if (lastBotMoveHash) {
    if (boardHash === lastBotMoveHash) {
      return {
        botTurnStatus: "opponent-turn",
        confidence: "medium",
        reason: "waiting for computer reply; board unchanged after bot move",
        boardHash,
        boardChangedSinceLastObservation
      };
    }

    return {
      botTurnStatus: "bot-turn",
      confidence: "medium",
      reason: "board changed after bot move; inferred computer reply completed",
      boardHash,
      boardChangedSinceLastObservation
    };
  }

  return {
    botTurnStatus: "unknown",
    confidence: "low",
    reason: "side to move is unknown and no prior bot move is available",
    boardHash,
    boardChangedSinceLastObservation
  };
}

export function boardHashFromFen(fen: string | null): string | null {
  const placement = fen?.trim().split(/\s+/)[0] ?? null;
  return placement && placement.length > 0 ? placement : null;
}
