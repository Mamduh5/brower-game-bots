import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

export type ChessColor = "white" | "black";
export type ChessPieceKind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type ChessSquare = `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type ChessCheckEvasionMoveType = "capture-checking-piece" | "block-check" | "king-move" | null;

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

export interface ChessPolicyOptions {
  readonly recentFenHistory?: readonly string[];
  readonly recentMoveHistory?: readonly string[];
  readonly searchDepth?: number;
  readonly maxSearchNodes?: number;
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
  readonly promotionPiece: ChessPieceKind | null;
  readonly checkEvasionRequired: boolean;
  readonly checkEvasionMoveType: ChessCheckEvasionMoveType;
  readonly score: number;
  readonly reason: string;
  readonly reasons: readonly string[];
  readonly givesCheck: boolean;
  readonly givesCheckmate: boolean;
  readonly avoidsStalemate: boolean;
  readonly materialBalanceAfter: number;
  readonly repetitionCount: number;
  readonly searchDepth: number;
  readonly evaluatedNodeCount: number;
  readonly resultingFen: string;
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
  readonly searchDepth: number;
  readonly evaluatedNodeCount: number;
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
const DEFAULT_SEARCH_DEPTH = 2;
const DEFAULT_MAX_SEARCH_NODES = 12_000;
const CHECKMATE_SCORE = 100_000;
const STALEMATE_WHILE_WINNING_PENALTY = 80_000;
const REPEATED_BOARD_PENALTY = 1_200;
const THREEFOLD_LIKE_PENALTY = 8_000;
const BACKTRACK_MOVE_PENALTY = 900;

interface NormalizedChessPolicyOptions {
  readonly recentFenHistory: readonly string[];
  readonly recentMoveHistory: readonly string[];
  readonly searchDepth: number;
  readonly maxSearchNodes: number;
}

interface SearchStats {
  nodes: number;
}

export function chooseBeginnerChessMove(board: ChessBoardState, options: ChessPolicyOptions = {}): ChessMoveChoice | null {
  const evaluation = evaluateChessPosition(board, options);
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

export function evaluateChessPosition(board: ChessBoardState): ChessEvaluation | null;
export function evaluateChessPosition(board: ChessBoardState, options: ChessPolicyOptions): ChessEvaluation | null;
export function evaluateChessPosition(board: ChessBoardState, options: ChessPolicyOptions = {}): ChessEvaluation | null {
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
  const normalizedOptions = normalizePolicyOptions(options);
  let evaluatedNodeCount = 0;
  const candidates = legalMoves
    .map((move) => {
      const candidate = evaluateCandidate({
        fen: board.fen as string,
        move,
        botColor: board.botColor,
        materialBalanceBefore: materialBalance,
        inCheck: chess.isCheck(),
        options: normalizedOptions
      });
      evaluatedNodeCount += candidate?.evaluatedNodeCount ?? 0;
      return candidate;
    })
    .filter((candidate): candidate is ChessMoveCandidate => Boolean(candidate))
    .sort(compareCandidates);

  return {
    legalMoveCount: legalMoves.length,
    materialBalance,
    inCheck: chess.isCheck(),
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    searchDepth: normalizedOptions.searchDepth,
    evaluatedNodeCount,
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

function normalizePolicyOptions(options: ChessPolicyOptions): NormalizedChessPolicyOptions {
  const requestedDepth = Number.isInteger(options.searchDepth) ? options.searchDepth ?? DEFAULT_SEARCH_DEPTH : DEFAULT_SEARCH_DEPTH;
  const requestedMaxNodes = Number.isInteger(options.maxSearchNodes) ? options.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES : DEFAULT_MAX_SEARCH_NODES;
  return {
    recentFenHistory: options.recentFenHistory ?? [],
    recentMoveHistory: options.recentMoveHistory ?? [],
    searchDepth: Math.max(0, Math.min(3, requestedDepth)),
    maxSearchNodes: Math.max(200, Math.min(80_000, requestedMaxNodes))
  };
}

function searchPosition(
  chess: Chess,
  botColor: ChessColor,
  depth: number,
  alpha: number,
  beta: number,
  stats: SearchStats,
  maxNodes: number
): number {
  stats.nodes += 1;
  if (stats.nodes >= maxNodes || depth <= 0 || chess.isGameOver()) {
    return evaluateStaticPosition(chess, botColor);
  }

  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return evaluateStaticPosition(chess, botColor);
  }

  const maximizing = chess.turn() === toChessJsColor(botColor);
  if (maximizing) {
    let value = -Infinity;
    for (const move of orderSearchMoves(moves)) {
      chess.move(move);
      value = Math.max(value, searchPosition(chess, botColor, depth - 1, alpha, beta, stats, maxNodes));
      chess.undo();
      alpha = Math.max(alpha, value);
      if (beta <= alpha || stats.nodes >= maxNodes) {
        break;
      }
    }
    return value;
  }

  let value = Infinity;
  for (const move of orderSearchMoves(moves)) {
    chess.move(move);
    value = Math.min(value, searchPosition(chess, botColor, depth - 1, alpha, beta, stats, maxNodes));
    chess.undo();
    beta = Math.min(beta, value);
    if (beta <= alpha || stats.nodes >= maxNodes) {
      break;
    }
  }
  return value;
}

function orderSearchMoves(moves: readonly Move[]): readonly Move[] {
  return [...moves].sort((left, right) => searchMovePriority(right) - searchMovePriority(left));
}

function searchMovePriority(move: Move): number {
  let priority = 0;
  if (move.captured) {
    priority += pieceValue(fromPieceSymbol(move.captured)) * 10 - pieceValue(fromPieceSymbol(move.piece));
  }
  if (move.promotion) {
    priority += pieceValue(fromPieceSymbol(move.promotion));
  }
  if (move.san.includes("#")) {
    priority += CHECKMATE_SCORE;
  } else if (move.san.includes("+")) {
    priority += 100;
  }
  return priority;
}

function evaluateStaticPosition(chess: Chess, botColor: ChessColor): number {
  if (chess.isCheckmate()) {
    return chess.turn() === toChessJsColor(botColor) ? -CHECKMATE_SCORE : CHECKMATE_SCORE;
  }

  const material = evaluateMaterialBalance(chess.fen(), botColor);
  if (chess.isStalemate()) {
    return material > 250 ? -20_000 : 0;
  }
  if (chess.isDraw()) {
    return material > 250 ? -6_000 : 0;
  }

  return material + positionalScore(chess, botColor);
}

function positionalScore(chess: Chess, botColor: ChessColor): number {
  const botJsColor = toChessJsColor(botColor);
  const opponentJsColor = toChessJsColor(oppositeColor(botColor));
  const endgame = isEndgame(chess);
  let score = 0;
  let botKing: Square | null = null;
  let opponentKing: Square | null = null;

  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) {
        continue;
      }
      const kind = fromPieceSymbol(piece.type);
      if (kind === "king") {
        if (piece.color === botJsColor) {
          botKing = piece.square;
        } else if (piece.color === opponentJsColor) {
          opponentKing = piece.square;
        }
      }
      const sign = piece.color === botJsColor ? 1 : -1;
      if (kind === "pawn") {
        const advancement = pawnAdvancement(piece.square, piece.color === "w" ? "white" : "black");
        score += sign * advancement * 12;
        if (isPassedPawn(chess, piece.square, piece.color)) {
          score += sign * (80 + advancement * 22);
        }
      }
      if (endgame && piece.color === botJsColor && (kind === "rook" || kind === "queen")) {
        score += distanceToBoardEdge(piece.square) <= 1 ? 18 : 0;
      }
    }
  }

  if (endgame && botKing && opponentKing) {
    score += (6 - manhattanDistance(botKing, opponentKing)) * 18;
    score += (3 - distanceToCenter(botKing)) * 14;
    score += (3 - distanceToBoardEdge(opponentKing)) * 35;
  }

  return Math.round(score);
}

function evaluateCandidate(input: {
  readonly fen: string;
  readonly move: Move;
  readonly botColor: ChessColor;
  readonly materialBalanceBefore: number;
  readonly inCheck: boolean;
  readonly options: NormalizedChessPolicyOptions;
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
  const checkEvasionMoveType = input.inCheck ? classifyCheckEvasion(movedPiece, captured) : null;
  const opponentColor = oppositeColor(input.botColor);
  const opponentJsColor = toChessJsColor(opponentColor);
  const materialBalanceAfter = evaluateMaterialBalance(chess.fen(), input.botColor);
  const resultingFen = chess.fen();
  const materialDelta = materialBalanceAfter - input.materialBalanceBefore;
  const searchStats: SearchStats = { nodes: 0 };
  const searchScore =
    input.options.searchDepth > 0
      ? searchPosition(chess, input.botColor, input.options.searchDepth - 1, -Infinity, Infinity, searchStats, input.options.maxSearchNodes)
      : evaluateStaticPosition(chess, input.botColor);
  const repetitionCount = repetitionCountForFen(resultingFen, input.options.recentFenHistory);
  const backtracks = isBacktrackingMove(appliedMove, input.options.recentMoveHistory);
  const reasons: string[] = [];
  let score = materialDelta + (searchScore - input.materialBalanceBefore);

  if (input.inCheck) {
    score += 10000;
    if (checkEvasionMoveType === "capture-checking-piece") {
      reasons.push("captures checking piece");
    } else if (checkEvasionMoveType === "king-move") {
      reasons.push("king moves out of check");
    } else {
      reasons.push("blocks check");
    }
  }

  if (chess.isCheckmate()) {
    score += CHECKMATE_SCORE;
    reasons.push("checkmate available");
  } else if (chess.isStalemate()) {
    if (input.materialBalanceBefore > 250) {
      score -= STALEMATE_WHILE_WINNING_PENALTY;
      reasons.push("avoids stalemate while winning");
    } else {
      score -= 900;
      reasons.push("avoids draw by stalemate");
    }
  } else if (chess.isCheck()) {
    score += 80;
    reasons.push("gives check");
  }

  if (repetitionCount >= 3) {
    score -= THREEFOLD_LIKE_PENALTY;
    reasons.push("avoids threefold-like repetition");
  } else if (repetitionCount === 2) {
    score -= REPEATED_BOARD_PENALTY;
    reasons.push("avoids repeated board");
  }

  if (backtracks) {
    score -= BACKTRACK_MOVE_PENALTY;
    reasons.push("avoids back-and-forth move");
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

  score += progressScore(input.fen, chess, appliedMove, movedPiece, input.botColor, input.materialBalanceBefore, reasons);

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
    promotionPiece: promotion,
    checkEvasionRequired: input.inCheck,
    checkEvasionMoveType,
    score: Math.round(score),
    reason: summarizeReason(reasons),
    reasons,
    givesCheck: chess.isCheck(),
    givesCheckmate: chess.isCheckmate(),
    avoidsStalemate: !chess.isStalemate(),
    materialBalanceAfter,
    repetitionCount,
    searchDepth: input.options.searchDepth,
    evaluatedNodeCount: searchStats.nodes,
    resultingFen
  };
}

function progressScore(
  beforeFen: string,
  after: Chess,
  move: Move,
  movedPiece: ChessPieceKind,
  botColor: ChessColor,
  materialBalanceBefore: number,
  reasons: string[]
): number {
  if (isOpeningPosition(beforeFen) || materialBalanceBefore < 300) {
    return 0;
  }

  let score = 0;
  if (movedPiece === "pawn") {
    const beforeAdvance = pawnAdvancement(move.from, botColor);
    const afterAdvance = pawnAdvancement(move.to, botColor);
    const progress = afterAdvance - beforeAdvance;
    if (progress > 0) {
      score += 45 + progress * 30;
      reasons.push("advances pawn in winning endgame");
    }
    const target = after.board().flat().find((piece) => piece?.square === move.to) ?? null;
    if (target && isPassedPawn(after, target.square, target.color)) {
      score += 110;
      reasons.push("pushes passed pawn");
    }
  }

  if (movedPiece === "king" && isEndgame(after)) {
    score += 50;
    reasons.push("activates king in endgame");
  }

  if (move.captured && materialBalanceBefore > 500) {
    score += 80;
    reasons.push("trades while ahead");
  }

  if (after.isCheck() && !move.captured && !after.isCheckmate()) {
    score -= 35;
  }

  return score;
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

function repetitionCountForFen(fen: string, history: readonly string[]): number {
  const key = repetitionKeyFromFen(fen);
  if (!key) {
    return 1;
  }
  return 1 + history.filter((entry) => repetitionKeyFromFen(entry) === key).length;
}

function repetitionKeyFromFen(fen: string | null): string | null {
  const parts = fen?.trim().split(/\s+/);
  if (!parts || parts.length < 1) {
    return null;
  }
  return parts[0] ?? null;
}

function isBacktrackingMove(move: Move, recentMoves: readonly string[]): boolean {
  const latest = recentMoves[recentMoves.length - 1];
  if (!latest || latest.length < 4) {
    return false;
  }
  return latest.slice(0, 2) === move.to && latest.slice(2, 4) === move.from;
}

function isEndgame(chess: Chess): boolean {
  let nonKingMaterial = 0;
  let queens = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.type === "k") {
        continue;
      }
      nonKingMaterial += pieceValue(fromPieceSymbol(piece.type));
      if (piece.type === "q") {
        queens += 1;
      }
    }
  }
  return queens === 0 || nonKingMaterial <= 2_500;
}

function pawnAdvancement(square: Square | ChessSquare, color: ChessColor): number {
  const rank = Number(square[1] ?? "0");
  return color === "white" ? rank - 2 : 7 - rank;
}

function isPassedPawn(chess: Chess, square: Square, color: Color): boolean {
  const fileIndex = fileToIndex(square[0] ?? "");
  const rank = Number(square[1] ?? "0");
  const opponentColor = color === "w" ? "b" : "w";
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.type !== "p" || piece.color !== opponentColor) {
        continue;
      }
      const opponentFileIndex = fileToIndex(piece.square[0] ?? "");
      if (Math.abs(opponentFileIndex - fileIndex) > 1) {
        continue;
      }
      const opponentRank = Number(piece.square[1] ?? "0");
      if (color === "w" ? opponentRank > rank : opponentRank < rank) {
        return false;
      }
    }
  }
  return true;
}

function fileToIndex(file: string): number {
  return "abcdefgh".indexOf(file);
}

function manhattanDistance(left: Square, right: Square): number {
  return Math.abs(fileToIndex(left[0] ?? "") - fileToIndex(right[0] ?? "")) + Math.abs(Number(left[1] ?? "0") - Number(right[1] ?? "0"));
}

function distanceToCenter(square: Square): number {
  const file = fileToIndex(square[0] ?? "");
  const rank = Number(square[1] ?? "0") - 1;
  return Math.min(...[3, 4].map((centerFile) => Math.abs(file - centerFile))) + Math.min(Math.abs(rank - 3), Math.abs(rank - 4));
}

function distanceToBoardEdge(square: Square): number {
  const file = fileToIndex(square[0] ?? "");
  const rank = Number(square[1] ?? "0") - 1;
  return Math.min(file, 7 - file, rank, 7 - rank);
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
  const checkEvasion = reasons.find(
    (reason) => reason === "captures checking piece" || reason === "king moves out of check" || reason === "blocks check"
  );
  if (checkEvasion) {
    return checkEvasion;
  }
  const queenWin = reasons.find((reason) => reason === "wins queen");
  if (queenWin) {
    return queenWin;
  }
  const repetition = reasons.find((reason) => reason.includes("repetition") || reason.includes("repeated board") || reason.includes("back-and-forth"));
  if (repetition) {
    return repetition;
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

function classifyCheckEvasion(movedPiece: ChessPieceKind, captured: ChessPieceKind | null): ChessCheckEvasionMoveType {
  if (movedPiece === "king") {
    return "king-move";
  }
  if (captured) {
    return "capture-checking-piece";
  }
  return "block-check";
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
