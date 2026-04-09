import type { RunReport } from "@game-bots/contracts";

export function toJsonReport(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}
