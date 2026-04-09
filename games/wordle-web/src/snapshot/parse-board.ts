import type { ObservationFrame } from "@game-bots/environment-sdk";

export interface ParsedBoardState {
  rows: readonly string[];
}

export function parseBoard(_frame: ObservationFrame): ParsedBoardState {
  return {
    rows: []
  };
}
