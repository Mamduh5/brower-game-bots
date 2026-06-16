export const CHESS_COM_SELECTORS = {
  defaultUrl: "https://www.chess.com/play/computer",
  unsafePathPatterns: [
    /\/play\/online/i,
    /\/game\/live/i,
    /\/play\/arena/i,
    /\/tournament/i,
    /\/live/i
  ],
  boardCandidates: [
    "wc-chess-board",
    "chess-board",
    ".board",
    ".board-layout-chessboard",
    "[class*='chessboard']"
  ],
  computerModeCandidates: [
    "a[href*='/play/computer']",
    "button:has-text('Computer')",
    "button:has-text('Play Computer')"
  ]
} as const;
