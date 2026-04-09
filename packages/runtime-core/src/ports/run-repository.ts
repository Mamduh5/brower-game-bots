import type { RunEvent, RunPhase, RunRecord, RunReport, RunRequest } from "@game-bots/contracts";

export interface RunRepository {
  createRun(request: RunRequest): Promise<RunRecord>;
  getRun(runId: string): Promise<RunRecord | null>;
  transitionRun(runId: string, phase: RunPhase, updatedAt: string): Promise<void>;
  appendEvent(event: RunEvent): Promise<void>;
  listEvents(runId: string): Promise<readonly RunEvent[]>;
  saveReport(report: RunReport): Promise<void>;
}
