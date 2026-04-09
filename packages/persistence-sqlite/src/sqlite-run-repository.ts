import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import {
  RunEventSchema,
  RunRecordSchema,
  RunReportSchema,
  type RunEvent,
  type RunPhase,
  type RunRecord,
  type RunReport,
  type RunRequest
} from "@game-bots/contracts";
import { deriveRunStatus, type RunRepository } from "@game-bots/runtime-core";

import { SQLITE_SCHEMA } from "./schema.js";

export interface SqliteRunRepositoryOptions {
  filename: string;
}

export class SqliteRunRepository implements RunRepository {
  private readonly db: Database.Database;

  constructor(private readonly options: SqliteRunRepositoryOptions) {
    mkdirSync(path.dirname(options.filename), { recursive: true });
    this.db = new Database(options.filename);
    this.db.exec(SQLITE_SCHEMA);
  }

  async createRun(request: RunRequest): Promise<RunRecord> {
    const now = new Date().toISOString();
    const record: RunRecord = RunRecordSchema.parse({
      runId: randomUUID(),
      agentKind: request.agentKind,
      gameId: request.gameId,
      environmentId: request.environmentId,
      profileId: request.profileId,
      scenarioId: request.scenarioId,
      phase: "created",
      status: "active",
      createdAt: now,
      updatedAt: now,
      config: request.config
    });

    this.db
      .prepare(
        `INSERT INTO runs (
          run_id, agent_kind, game_id, environment_id, profile_id, scenario_id,
          phase, status, created_at, updated_at, config_json
        ) VALUES (
          @runId, @agentKind, @gameId, @environmentId, @profileId, @scenarioId,
          @phase, @status, @createdAt, @updatedAt, @configJson
        )`
      )
      .run({
        ...record,
        configJson: JSON.stringify(record.config)
      });

    return record;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const row = this.db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return RunRecordSchema.parse({
      runId: row.run_id,
      agentKind: row.agent_kind,
      gameId: row.game_id,
      environmentId: row.environment_id,
      profileId: row.profile_id ?? undefined,
      scenarioId: row.scenario_id ?? undefined,
      phase: row.phase,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      config: JSON.parse(String(row.config_json))
    });
  }

  async transitionRun(runId: string, phase: RunPhase, updatedAt: string): Promise<void> {
    const status = deriveRunStatus(phase);
    this.db
      .prepare("UPDATE runs SET phase = ?, status = ?, updated_at = ? WHERE run_id = ?")
      .run(phase, status, updatedAt, runId);
  }

  async appendEvent(event: RunEvent): Promise<void> {
    this.db
      .prepare("INSERT INTO events (event_id, run_id, sequence, timestamp, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(event.eventId, event.runId, event.sequence, event.timestamp, event.type, JSON.stringify(event));
  }

  async listEvents(runId: string): Promise<readonly RunEvent[]> {
    const rows = this.db
      .prepare("SELECT payload_json FROM events WHERE run_id = ? ORDER BY sequence ASC")
      .all(runId) as Array<{ payload_json: string }>;

    return rows.map((row) => RunEventSchema.parse(JSON.parse(row.payload_json)));
  }

  async saveReport(report: RunReport): Promise<void> {
    const parsed = RunReportSchema.parse(report);

    this.db
      .prepare(
        `INSERT INTO reports (report_id, run_id, generated_at, payload_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET report_id = excluded.report_id, generated_at = excluded.generated_at, payload_json = excluded.payload_json`
      )
      .run(parsed.reportId, parsed.runId, parsed.generatedAt, JSON.stringify(parsed));
  }
}
