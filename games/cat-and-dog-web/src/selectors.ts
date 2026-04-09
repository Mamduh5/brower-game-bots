export const CAT_AND_DOG_SELECTORS = {
  appRootCandidates: ["#root", "#app", "main", "[data-testid='app-root']", ".game-container"],
  playableSurfaceCandidates: ["canvas", ".game-canvas", "[data-testid='game-canvas']"]
} as const;
