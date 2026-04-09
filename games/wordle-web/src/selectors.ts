export const WORDLE_SELECTORS = {
  appRoot: "body",
  tiles: "[data-testid='tile']",
  keyboardKey: (key: string) => `button[data-key='${key}']`
} as const;
