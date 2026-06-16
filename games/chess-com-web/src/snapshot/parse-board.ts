export type ChessColor = "white" | "black";
export type ChessPieceKind = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export interface ChessComPiece {
  readonly color: ChessColor;
  readonly kind: ChessPieceKind;
  readonly square: string;
}

export interface ChessBoardBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ChessComBoardState {
  readonly boardDetected: boolean;
  readonly orientation: ChessColor;
  readonly sideToMove: ChessColor | null;
  readonly pieces: readonly ChessComPiece[];
  readonly pieceMap: Readonly<Record<string, { readonly color: ChessColor; readonly kind: ChessPieceKind }>>;
  readonly fen: string | null;
  readonly boardBounds: ChessBoardBounds | null;
  readonly unsafeHumanMatchmaking: boolean;
  readonly safetyReason: string | null;
  readonly outcome: string | null;
  readonly lastMove: string | null;
  readonly moveListLength: number | null;
  readonly promotionUiDetected: boolean;
  readonly promotionChoiceCount: number;
  readonly promotionQueenBounds: ChessBoardBounds | null;
}

interface RuntimeProbePiece {
  readonly className?: unknown;
}

interface RuntimeProbePayload {
  readonly url?: unknown;
  readonly title?: unknown;
  readonly bodyText?: unknown;
  readonly boardClassName?: unknown;
  readonly boardBounds?: unknown;
  readonly pieces?: unknown;
  readonly sideToMoveText?: unknown;
  readonly lastMoveText?: unknown;
  readonly moveListLength?: unknown;
  readonly promotionUiDetected?: unknown;
  readonly promotionChoiceCount?: unknown;
  readonly promotionQueenBounds?: unknown;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export const CHESS_COM_BOARD_RUNTIME_PROBE = {
  id: "chess-com-board-state",
  script: `
return (() => {
  const boardSelectors = ["wc-chess-board", "chess-board", ".board", ".board-layout-chessboard", "[class*='chessboard']"];
  const boards = boardSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((element) => ({ selector, element })));
  const board = boards
    .map((entry) => ({ ...entry, rect: entry.element.getBoundingClientRect(), pieceCount: entry.element.querySelectorAll(".piece").length }))
    .filter((entry) => {
      const aspectDelta = Math.abs(entry.rect.width - entry.rect.height) / Math.max(entry.rect.width, entry.rect.height);
      return entry.rect.width > 180 && entry.rect.height > 180 && aspectDelta < 0.15 && entry.pieceCount > 0;
    })
    .sort((left, right) => {
      const leftAspect = Math.abs(left.rect.width - left.rect.height) / Math.max(left.rect.width, left.rect.height);
      const rightAspect = Math.abs(right.rect.width - right.rect.height) / Math.max(right.rect.width, right.rect.height);
      const leftExactBoard = left.selector === ".board" || left.element.tagName.toLowerCase().includes("chess-board") ? 1 : 0;
      const rightExactBoard = right.selector === ".board" || right.element.tagName.toLowerCase().includes("chess-board") ? 1 : 0;
      return rightExactBoard - leftExactBoard
        || leftAspect - rightAspect
        || right.pieceCount - left.pieceCount
        || (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
    })[0] ?? null;
  const root = board?.element ?? document;
  const pieces = Array.from(root.querySelectorAll(".piece"))
    .concat(Array.from(document.querySelectorAll(".piece")))
    .map((element) => ({ className: element.className ? String(element.className) : "" }));
  const uniquePieces = Array.from(new Map(pieces.map((piece) => [piece.className, piece])).values());
  const bodyText = document.body?.innerText ?? "";
  const turnNode = document.querySelector("[class*='clock-player-turn'], [class*='clock'][class*='turn']");
  const moveNodes = Array.from(document.querySelectorAll(".move-list-row, [class*='move-list'] [class*='move']"));
  const lastMoveNode = moveNodes[moveNodes.length - 1] ?? null;
  const promotionRoots = Array.from(document.querySelectorAll(
    ".promotion-piece, [class*='promotion'], [data-cy*='promotion'], [aria-label*='promotion' i]"
  ));
  const promotionChoices = promotionRoots
    .flatMap((root) => [root].concat(Array.from(root.querySelectorAll(".piece, [class*='queen'], [class*='promotion'], button, [role='button']"))))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const label = [
        element.getAttribute("aria-label"),
        element.getAttribute("data-cy"),
        element.getAttribute("title"),
        element.className ? String(element.className) : "",
        element.textContent ?? ""
      ].join(" ");
      return {
        label,
        visible: rect.width > 8 && rect.height > 8,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      };
    })
    .filter((entry) => entry.visible);
  const queenChoice = promotionChoices.find((entry) => /queen|\\bwq\\b|\\bbq\\b|\\bq\\b/i.test(entry.label)) ?? null;
  return {
    url: location.href,
    title: document.title,
    bodyText: bodyText.slice(0, 5000),
    boardClassName: board?.element ? String(board.element.className ?? "") : "",
    boardBounds: board ? {
      x: board.rect.x,
      y: board.rect.y,
      width: board.rect.width,
      height: board.rect.height
    } : null,
    pieces: uniquePieces,
    sideToMoveText: turnNode?.textContent ?? "",
    lastMoveText: lastMoveNode?.textContent ?? "",
    moveListLength: moveNodes.length,
    promotionUiDetected: promotionChoices.length > 0,
    promotionChoiceCount: promotionChoices.length,
    promotionQueenBounds: queenChoice?.bounds ?? null
  };
})();`
} as const;

export function parseChessComBoard(input: {
  readonly html?: string | null;
  readonly runtimeProbe?: unknown;
  readonly url?: string | null;
  readonly title?: string | null;
}): ChessComBoardState {
  const probe = asRecord(input.runtimeProbe) as RuntimeProbePayload;
  const html = input.html ?? "";
  const url = readString(probe.url) ?? input.url ?? "";
  const title = readString(probe.title) ?? input.title ?? "";
  const bodyText = readString(probe.bodyText) ?? stripTags(html).slice(0, 5000);
  const boardClassName = readString(probe.boardClassName) ?? firstBoardClassName(html);
  const pieces = parsePieces(probe.pieces ?? html);
  const orientation = /flipped|black-perspective|orientation-black/i.test(boardClassName) ? "black" : "white";
  const pieceMap = Object.fromEntries(pieces.map((piece) => [piece.square, { color: piece.color, kind: piece.kind }]));
  const safety = detectSafetyRisk({ url, title, bodyText });
  const sideToMove = detectSideToMove(readString(probe.sideToMoveText), bodyText, pieceMap);

  return {
    boardDetected: pieces.length >= 2,
    orientation,
    sideToMove,
    pieces,
    pieceMap,
    fen: pieces.length >= 2 ? buildFen(pieceMap, sideToMove) : null,
    boardBounds: parseBounds(probe.boardBounds),
    unsafeHumanMatchmaking: safety.unsafe,
    safetyReason: safety.reason,
    outcome: detectOutcome(bodyText),
    lastMove: readString(probe.lastMoveText),
    moveListLength: readNumber(probe.moveListLength),
    promotionUiDetected: readBoolean(probe.promotionUiDetected) ?? false,
    promotionChoiceCount: readNumber(probe.promotionChoiceCount) ?? 0,
    promotionQueenBounds: parseBounds(probe.promotionQueenBounds)
  };
}

export function squareCenter(
  square: string,
  bounds: ChessBoardBounds,
  orientation: ChessColor
): { readonly x: number; readonly y: number } | null {
  const match = /^([a-h])([1-8])$/.exec(square);
  if (!match) {
    return null;
  }
  const fileIndex = FILES.indexOf(match[1] as (typeof FILES)[number]);
  const rank = Number(match[2]);
  const visualFile = orientation === "white" ? fileIndex : 7 - fileIndex;
  const visualRank = orientation === "white" ? 8 - rank : rank - 1;
  const boardSize = Math.min(bounds.width, bounds.height);
  const offsetX = (bounds.width - boardSize) / 2;
  const offsetY = (bounds.height - boardSize) / 2;
  const squareSize = boardSize / 8;
  return {
    x: bounds.x + offsetX + squareSize * (visualFile + 0.5),
    y: bounds.y + offsetY + squareSize * (visualRank + 0.5)
  };
}

export function promotionQueenClickPoint(
  targetSquare: string,
  bounds: ChessBoardBounds,
  orientation: ChessColor
): { readonly x: number; readonly y: number } | null {
  return squareCenter(targetSquare, bounds, orientation);
}

function parsePieces(source: unknown): ChessComPiece[] {
  const classNames = Array.isArray(source)
    ? source.map((piece) => readString((asRecord(piece) as RuntimeProbePiece).className)).filter((value): value is string => Boolean(value))
    : parsePieceClassNames(String(source ?? ""));
  const pieces: ChessComPiece[] = [];

  for (const className of classNames) {
    const tokens = className.split(/\s+/).filter(Boolean);
    const pieceToken = tokens.find((token) => /^[wb][prnbqk]$/.test(token));
    const squareToken = tokens.find((token) => /^square-[1-8][1-8]$/.test(token));
    if (!pieceToken || !squareToken) {
      continue;
    }
    const pieceCode = pieceToken[1];
    if (!pieceCode) {
      continue;
    }
    pieces.push({
      color: pieceToken[0] === "w" ? "white" : "black",
      kind: pieceKind(pieceCode),
      square: squareClassToAlgebraic(squareToken)
    });
  }

  return pieces.sort((left, right) => left.square.localeCompare(right.square));
}

function parsePieceClassNames(html: string): string[] {
  return [...html.matchAll(/class=["']([^"']*\bpiece\b[^"']*)["']/gi)].map((match) => match[1] ?? "");
}

function squareClassToAlgebraic(squareClass: string): string {
  const [, fileRaw, rankRaw] = /^square-([1-8])([1-8])$/.exec(squareClass) ?? [];
  return `${FILES[Number(fileRaw) - 1]}${rankRaw}`;
}

function pieceKind(token: string): ChessPieceKind {
  switch (token) {
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
    default:
      return "king";
  }
}

function buildFen(
  pieces: Readonly<Record<string, { readonly color: ChessColor; readonly kind: ChessPieceKind }>>,
  sideToMove: ChessColor | null
): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;
    for (const file of FILES) {
      const piece = pieces[`${file}${rank}`];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const letter = pieceLetter(piece.kind);
      row += piece.color === "white" ? letter.toUpperCase() : letter;
    }
    if (empty > 0) {
      row += String(empty);
    }
    ranks.push(row);
  }
  return `${ranks.join("/")} ${sideToMove === "black" ? "b" : "w"} - - 0 1`;
}

function pieceLetter(kind: ChessPieceKind): string {
  switch (kind) {
    case "pawn":
      return "p";
    case "knight":
      return "n";
    case "bishop":
      return "b";
    case "rook":
      return "r";
    case "queen":
      return "q";
    case "king":
      return "k";
  }
}

function detectSideToMove(
  turnText: string | null,
  bodyText: string,
  pieces: Readonly<Record<string, { readonly color: ChessColor; readonly kind: ChessPieceKind }>>
): ChessColor | null {
  const text = `${turnText ?? ""}\n${bodyText}`;
  if (/black to move|black's move|black move/i.test(text)) {
    return "black";
  }
  if (/white to move|white's move|white move|your move/i.test(text)) {
    return "white";
  }
  if (isStartingPosition(pieces)) {
    return "white";
  }
  return null;
}

function isStartingPosition(pieces: Readonly<Record<string, { readonly color: ChessColor; readonly kind: ChessPieceKind }>>): boolean {
  return pieces.e2?.kind === "pawn" && pieces.e2.color === "white" && pieces.e7?.kind === "pawn" && pieces.e7.color === "black";
}

function detectSafetyRisk(input: { readonly url: string; readonly title: string; readonly bodyText: string }): {
  readonly unsafe: boolean;
  readonly reason: string | null;
} {
  const combined = `${input.url}\n${input.title}\n${input.bodyText}`;
  const unsafePattern = /\/play\/online|\/game\/live|\/play\/arena|\/tournament|\blive chess\b|\brated\b|\bblitz\b|\brapid\b|\bdaily\b|\barena\b|\bsearching for opponent\b/i;
  if (unsafePattern.test(combined) && !/computer|bot|coach/i.test(combined)) {
    return {
      unsafe: true,
      reason: "Detected online/live human matchmaking language or URL."
    };
  }
  return {
    unsafe: false,
    reason: null
  };
}

function detectOutcome(bodyText: string): string | null {
  if (/you won|checkmate.*you win|game won/i.test(bodyText)) {
    return "WIN";
  }
  if (/you lost|checkmate.*you lose|game lost/i.test(bodyText)) {
    return "LOSS";
  }
  if (/\bdraw\b|stalemate/i.test(bodyText)) {
    return "DRAW";
  }
  return null;
}

function parseBounds(value: unknown): ChessBoardBounds | null {
  const record = asRecord(value);
  const x = readNumber(record.x);
  const y = readNumber(record.y);
  const width = readNumber(record.width);
  const height = readNumber(record.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function firstBoardClassName(html: string): string {
  return [...html.matchAll(/class=["']([^"']*(?:board|chessboard)[^"']*)["']/gi)][0]?.[1] ?? "";
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
