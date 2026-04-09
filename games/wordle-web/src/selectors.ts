export const WORDLE_SELECTORS = {
  appRoot: "body",
  guessInput: "#guess-input",
  submitGuessButton: "#submit-guess",
  resetGameButton: "#reset-game",
  status: "#status",
  tiles: "[data-testid='tile']",
  keyboardKey: (key: string) => `button[data-key='${key}']`
} as const;
