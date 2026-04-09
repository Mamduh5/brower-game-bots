export interface SubmitGuessInput {
  guess: string;
}

export function buildSubmitGuessAction(input: SubmitGuessInput) {
  return {
    actionId: "submit-guess",
    description: `Submit guess ${input.guess}`,
    paramsExample: {
      guess: input.guess
    }
  };
}
