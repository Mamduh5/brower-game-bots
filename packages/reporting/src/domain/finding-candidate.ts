import type { Finding } from "@game-bots/contracts";

export interface FindingCandidate extends Finding {
  dedupeKey?: string;
}

export interface IssueCandidate {
  title: string;
  body: string;
  findingIds: readonly string[];
}
