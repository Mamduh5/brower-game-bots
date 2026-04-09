export const WORDLE_SELECTORS = {
  appRoot: "body",
  guessInput: "#guess-input",
  submitGuessButton: "#submit-guess",
  helpProbeShell: "#help-probe-shell",
  helpProbeTrigger: "#help-probe-trigger",
  helpProbeStatus: "#help-probe-status",
  resetGameButton: "#reset-game",
  status: "#status",
  tiles: "[data-testid='tile']",
  keyboardKey: (key: string) => `button[data-key='${key}']`
} as const;
