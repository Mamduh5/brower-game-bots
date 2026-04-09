export const CAT_AND_DOG_SELECTORS = {
  gameplayEntryRoute: "/play/desktop",
  appRootCandidates: ["#root", "#app", "main", "[data-testid='app-root']", ".game-container"],
  modeSelectionCandidates: ["#mode-selection", "[data-testid='mode-selection']", ".mode-selection"],
  twoPlayerButtonCandidates: [
    "#play-2-player",
    "[data-testid='play-2-player']",
    "button[data-mode='two-player']",
    "button:has-text('2 Player')"
  ],
  playableSurfaceCandidates: ["canvas", ".game-canvas", "[data-testid='game-canvas']"],
  gameplayHudCandidates: ["[data-testid='player-hud']", ".player-hud", "#player-hud", ".hud", "[data-testid='hud']"],
  gameplayControlsCandidates: ["#controls-hint", "[data-testid='controls-hint']", ".controls-hint"],
  aimStatusCandidates: ["#aim-status", "[data-testid='aim-status']", ".aim-status"],
  startControlCandidates: [
    "#start-game",
    "[data-testid='start-game']",
    ".start-game",
    ".start-button",
    "button[data-action='start']"
  ]
} as const;
