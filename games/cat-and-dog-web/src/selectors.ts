export const CAT_AND_DOG_SELECTORS = {
  gameplayEntryRoute: "/play/desktop",
  appRootCandidates: ["#playRoot", "#root", "#app", "main", "[data-testid='app-root']", ".game-container"],
  modeSelectionCandidates: [
    "#menuOverlay",
    "#mode-selection",
    "#menuActions",
    "[data-testid='mode-selection']",
    ".mode-selection"
  ],
  twoPlayerButtonCandidates: [
    "#playLocalButton",
    "#play-2-player",
    "[data-testid='play-2-player']",
    "button[data-mode='two-player']",
    "[data-testid='play-local']"
  ],
  playCpuButtonCandidates: [
    "#playCpuButton",
    "[data-testid='play-vs-cpu']",
    "button[data-mode='cpu']"
  ],
  difficultyPanelCandidates: ["#difficultyPanel", "[data-testid='difficulty-panel']"],
  easyDifficultyCandidates: ["#difficultyPanel [data-difficulty='easy']", "[data-testid='difficulty-easy']"],
  startCpuButtonCandidates: ["#startCpuButton", "[data-testid='start-cpu-match']"],
  playableSurfaceCandidates: ["#gameplaySurface", "#gameCanvas", "canvas", ".game-canvas", "[data-testid='game-canvas']"],
  gameplayHudCandidates: [
    "#modeLabel",
    "#matchNote",
    "#weaponBar",
    "[data-testid='player-hud']",
    ".player-hud",
    "#player-hud",
    ".hud",
    "[data-testid='hud']"
  ],
  gameplayControlsCandidates: ["#controls-hint", "#canvasHint", "[data-testid='controls-hint']", ".controls-hint", ".controls-list"],
  aimStatusCandidates: ["#aim-status", "[data-testid='aim-status']", ".aim-status"],
  powerStatusCandidates: ["#power-status", "[data-testid='power-status']", ".power-status"],
  matchNoteCandidates: ["#matchNote", "[data-testid='match-note']"],
  canvasHintCandidates: ["#canvasHint", "[data-testid='controls-hint']"],
  turnBannerCandidates: ["#turnBanner", "[data-testid='turn-banner']"],
  turnBannerTitleCandidates: ["#turnBannerTitle", "[data-testid='turn-banner-title']"],
  startControlCandidates: [
    "#playCpuButton",
    "#playLocalButton",
    "#start-game",
    "[data-testid='start-game']",
    ".start-game",
    ".start-button",
    "button[data-action='start']"
  ],
  menuOverlayCandidates: ["#menuOverlay", "#mode-selection"],
  weaponBarCandidates: ["#weaponBar", "[data-testid='weapon-bar']"],
  modeLabelCandidates: ["#modeLabel", "[data-testid='mode-label']"],
  endOverlayCandidates: ["#endOverlay", "[data-testid='end-overlay']"],
  endTitleCandidates: ["#endTitle", "[data-testid='end-title']"],
  endSubtitleCandidates: ["#endSubtitle", "[data-testid='end-subtitle']"]
} as const;
