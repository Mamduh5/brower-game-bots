export const CAT_AND_DOG_SELECTORS = {
  gameplayEntryRoute: "/play/desktop/",
  appRootCandidates: ["#root", "#app", "main", "[data-testid='app-root']", ".game-container"],
  playableSurfaceCandidates: ["canvas", ".game-canvas", "[data-testid='game-canvas']"],
  gameplayHudCandidates: ["[data-testid='player-hud']", ".player-hud", "#player-hud", ".hud", "[data-testid='hud']"],
  startControlCandidates: [
    "#start-game",
    "[data-testid='start-game']",
    ".start-game",
    ".start-button",
    "button[data-action='start']"
  ]
} as const;
