import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

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

export interface ChessMoveCandidate {
  readonly from: ChessSquare;
  readonly to: ChessSquare;
  readonly lan: string;
  readonly uci: string;
  readonly san: string;
  readonly piece: ChessPieceKind;
  readonly captured: ChessPieceKind | null;
  readonly promotion: ChessPieceKind | null;
  readonly score: number;
  readonly reason: string;
  readonly reasons: readonly string[];
  readonly givesCheck: boolean;
  readonly givesCheckmate: boolean;
  readonly materialBalanceAfter: number;
}

export interface ChessMoveChoice extends ChessMoveCandidate {
  readonly legalMoveCount: number;
  readonly topCandidates: readonly ChessMoveCandidate[];
  readonly materialBalanceBefore: number;
  readonly inCheck: boolean;
  readonly isCheckmate: boolean;
  readonly isStalemate: boolean;
}

export interface ChessEvaluation {
  readonly legalMoveCount: number;
  readonly materialBalance: number;
  readonly inCheck: boolean;
  readonly isCheckmate: boolean;
  readonly isStalemate: boolean;
  readonly candidates: readonly ChessMoveCandidate[];
}

export const CHESS_PIECE_VALUES: Readonly<Record<ChessPieceKind, number>> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 100000
};

const WHITE_PRIORITIES: readonly string[] = ["e2e4", "d2d4", "g1f3", "c2c4"];
const BLACK_PRIORITIES: readonly string[] = ["e7e5", "d7d5", "g8f6", "c7c5"];
const CENTER_SQUARES = new Set(["d4", "d5", "e4", "e5"]);
const NEAR_CENTER_SQUARES = new Set(["c3", "c4", "c5", "c6", "d3", "d6", "e3", "e6", "f3", "f4", "f5", "f6"]);

export function chooseBeginnerChessMove(board: ChessBoardState): ChessMoveChoice | null {
  const evaluation = evaluateChessPosition(board);
  const selected = evaluation?.candidates[0] ?? null;
  if (!evaluation || !selected) {
    return null;
  }

  return {
    ...selected,
    legalMoveCount: evaluation.legalMoveCount,
    topCandidates: evaluation.candidates.slice(0, 5),
    materialBalanceBefore: evaluation.materialBalance,
    inCheck: evaluation.inCheck,
    isCheckmate: evaluation.isCheckmate,
    isStalemate: evaluation.isStalemate
  };
}

export function evaluateChessPosition(board: ChessBoardState): ChessEvaluation | null {
  if (!board.fen || !board.sideToMove || board.sideToMove !== board.botColor) {
    return null;
  }

  let chess: Chess;
  try {
    chess = new Chess(board.fen);
  } catch {
    return null;
  }

  const botColor = toChessJsColor(board.botColor);
  if (chess.turn() !== botColor) {
    return null;
  }

  const legalMoves = chess.moves({ verbose: true });
  const materialBalance = evaluateMaterialBalance(board.fen, board.botColor);
  const candidates = legalMoves
    .map((move) => evaluateCandidate({ fen: board.fen as string, move, botColor: board.botColor, materialBalanceBefore: materialBalance }))
    .filter((candidate): candidate is ChessMoveCandidate => Boolean(candidate))
    .sort(compareCandidates);

  return {
    legalMoveCount: legalMoves.length,
    materialBalance,
    inCheck: chess.isCheck(),
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    candidates
  };
}

export function listLegalChessMoves(fen: string): readonly string[] {
  try {
    return new Chess(fen).moves({ verbose: true }).map(moveToLan);
  } catch {
    return [];
  }
}

export function evaluateMaterialBalance(fen: string, perspective: ChessColor = "white"): number {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return 0;
  }

  const perspectiveColor = toChessJsColor(perspective);
  let balance = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) {
        continue;
      }
      const value = pieceValue(fromPieceSymbol(piece.type));
      balance += piece.color === perspectiveColor ? value : -value;
    }
  }
  return balance;
}

function evaluateCandidate(input: {
  readonly fen: string;
  readonly move: Move;
  readonly botColor: ChessColor;
  readonly materialBalanceBefore: number;
}): ChessMoveCandidate | null {
  if (!isChessSquare(input.move.from) || !isChessSquare(input.move.to)) {
    return null;
  }

  const chess = new Chess(input.fen);
  let appliedMove: Move;
  try {
    const moveRequest = input.move.promotion
      ? { from: input.move.from, to: input.move.to, promotion: input.move.promotion }
      : { from: input.move.from, to: input.move.to };
    appliedMove = chess.move(moveRequest);
  } catch {
    return null;
  }

  const movedPiece = fromPieceSymbol(appliedMove.piece);
  const captured = appliedMove.captured ? fromPieceSymbol(appliedMove.captured) : null;
  const promotion = appliedMove.promotion ? fromPieceSymbol(appliedMove.promotion) : null;
  const opponentColor = oppositeColor(input.botColor);
  const opponentJsColor = toChessJsColor(opponentColor);
  const materialBalanceAfter = evaluateMaterialBalance(chess.fen(), input.botColor);
  const materialDelta = materialBalanceAfter - input.materialBalanceBefore;
  const reasons: string[] = [];
  let score = materialDelta;

  if (chess.isCheckmate()) {
    score += 100000;
    reasons.push("checkmate available");
  } else if (chess.isCheck()) {
    score += 80;
    reasons.push("gives check");
  }

  if (captured) {
    const capturedValue = pieceValue(captured);
    const moverValue = pieceValue(movedPiece);
    score += capturedValue;
    const targetIsAttacked = chess.isAttacked(appliedMove.to, opponentJsColor);
    if (captured === "queen") {
      reasons.push("wins queen");
    } else if (!targetIsAttacked) {
      reasons.push(`captures undefended ${captured}`);
    } else {
      reasons.push(`captures ${captured}`);
    }

    if (targetIsAttacked && moverValue > capturedValue) {
      score -= moverValue - capturedValue + 140;
      reasons.push(`avoids bad capture risk: ${movedPiece} would be exposed after taking ${captured}`);
    }
  }

  if (promotion) {
    const promotionGain = pieceValue(promotion) - pieceValue("pawn");
    score += promotionGain;
    reasons.push(promotion === "queen" ? "promotes to queen" : `promotes to ${promotion}`);
    if (promotion !== "queen") {
      score -= 500;
    }
  }

  if (appliedMove.isKingsideCastle() || appliedMove.isQueensideCastle()) {
    score += 120;
    reasons.push("improves king safety by castling");
  }

  if (isOpeningPosition(input.fen)) {
    score += openingScore(appliedMove, movedPiece, reasons);
  }

  const majorHangingPenalty = hangingMajorPiecePenalty(chess, input.botColor);
  if (majorHangingPenalty > 0) {
    score -= majorHangingPenalty;
    reasons.push("avoids hanging queen or rook");
  }

  if (movedPiece === "queen" && isOpeningPosition(input.fen) && !captured && !chess.isCheckmate()) {
    score -= 120;
    reasons.push("avoids early pointless queen move");
  }

  if (repeatsOpeningPieceMove(input.fen, appliedMove, movedPiece, input.botColor)) {
    score -= 70;
    reasons.push("avoids repeated pointless piece moves in the opening");
  }

  if (materialDelta > 0 && !captured) {
    reasons.push("improves material balance");
  }

  if (reasons.length === 0) {
    reasons.push("best material-preserving move");
  }

  return {
    from: appliedMove.from as ChessSquare,
    to: appliedMove.to as ChessSquare,
    lan: moveToLan(appliedMove),
    uci: moveToLan(appliedMove),
    san: appliedMove.san,
    piece: movedPiece,
    captured,
    promotion,
    score: Math.round(score),
    reason: summarizeReason(reasons),
    reasons,
    givesCheck: chess.isCheck(),
    givesCheckmate: chess.isCheckmate(),
    materialBalanceAfter
  };
}

function openingScore(move: Move, movedPiece: ChessPieceKind, reasons: string[]): number {
  let score = 0;
  const lan = moveToLan(move);
  const to = move.to;

  if ((movedPiece === "knight" || movedPiece === "bishop") && isBackRank(move.from, move.color)) {
    score += NEAR_CENTER_SQUARES.has(to) || CENTER_SQUARES.has(to) ? 95 : 70;
    reasons.push(`develops ${movedPiece} toward center`);
  }

  if (movedPiece === "pawn" && CENTER_SQUARES.has(to)) {
    score += 95;
    reasons.push("controls center with pawn");
  } else if (movedPiece === "pawn" && NEAR_CENTER_SQUARES.has(to)) {
    score += 35;
    reasons.push("supports center with pawn");
  }

  if (WHITE_PRIORITIES.includes(lan) || BLACK_PRIORITIES.includes(lan)) {
    score += 45;
    reasons.push("preferred opening development");
  }

  return score;
}

function hangingMajorPiecePenalty(chess: Chess, botColor: ChessColor): number {
  const botJsColor = toChessJsColor(botColor);
  const opponentJsColor = toChessJsColor(oppositeColor(botColor));
  let penalty = 0;

  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== botJsColor || (piece.type !== "q" && piece.type !== "r")) {
        continue;
      }
      const attackers = chess.attackers(piece.square, opponentJsColor).length;
      if (attackers === 0) {
        continue;
      }
      const defenders = chess.attackers(piece.square, botJsColor).length;
      if (attackers >= defenders) {
        penalty += piece.type === "q" ? 520 : 260;
      }
    }
  }

  return penalty;
}

function repeatsOpeningPieceMove(fen: string, move: Move, movedPiece: ChessPieceKind, botColor: ChessColor): boolean {
  if (!isOpeningPosition(fen) || movedPiece === "pawn" || movedPiece === "king") {
    return false;
  }
  const botIsWhite = botColor === "white";
  const homeRank = botIsWhite ? "1" : "8";
  return !move.from.endsWith(homeRank) && !CENTER_SQUARES.has(move.to) && !NEAR_CENTER_SQUARES.has(move.to);
}

function isOpeningPosition(fen: string): boolean {
  const moveNumber = Number(fen.trim().split(/\s+/)[5] ?? "1");
  if (Number.isFinite(moveNumber) && moveNumber > 12) {
    return false;
  }
  const piecePlacement = fen.split(/\s+/)[0] ?? "";
  const pieceCount = [...piecePlacement].filter((char) => /[prnbqk]/i.test(char)).length;
  return pieceCount >= 20;
}

function compareCandidates(left: ChessMoveCandidate, right: ChessMoveCandidate): number {
  return right.score - left.score || movePriority(left.lan) - movePriority(right.lan) || left.lan.localeCompare(right.lan);
}

function movePriority(lan: string): number {
  const allPriorities = [...WHITE_PRIORITIES, ...BLACK_PRIORITIES];
  const index = allPriorities.indexOf(lan);
  return index >= 0 ? index : 100;
}

function summarizeReason(reasons: readonly string[]): string {
  if (reasons.includes("checkmate available")) {
    return "checkmate available";
  }
  const queenWin = reasons.find((reason) => reason === "wins queen");
  if (queenWin) {
    return queenWin;
  }
  const capture = reasons.find((reason) => reason.startsWith("captures undefended"));
  if (capture) {
    return capture;
  }
  const center = reasons.find((reason) => reason.includes("center"));
  if (center) {
    return center;
  }
  const promotion = reasons.find((reason) => reason.startsWith("promotes"));
  if (promotion) {
    return promotion;
  }
  const castle = reasons.find((reason) => reason.includes("castling"));
  if (castle) {
    return castle;
  }
  const check = reasons.find((reason) => reason === "gives check");
  return check ?? reasons[0] ?? "best material-preserving move";
}

function moveToLan(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

function pieceValue(kind: ChessPieceKind): number {
  return CHESS_PIECE_VALUES[kind];
}

function fromPieceSymbol(symbol: PieceSymbol): ChessPieceKind {
  switch (symbol) {
    case "p":
      return "pawn";
    case "n":
      return "knight";
    case "b":
      return "bishop";
    case "r":
      return "rook";
    case "q":
      return "queen";
    case "k":
      return "king";
  }
}

function toChessJsColor(color: ChessColor): Color {
  return color === "white" ? "w" : "b";
}

function oppositeColor(color: ChessColor): ChessColor {
  return color === "white" ? "black" : "white";
}

function isBackRank(square: Square, color: Color): boolean {
  return square.endsWith(color === "w" ? "1" : "8");
}

function isChessSquare(value: string): value is ChessSquare {
  return /^[a-h][1-8]$/.test(value);
}
