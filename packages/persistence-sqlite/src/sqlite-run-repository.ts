import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import initSqlJs, { type Database } from "sql.js";
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

type SqlBindValue = number | string | Uint8Array | null;

export class SqliteRunRepository implements RunRepository {
  private readonly databasePromise: Promise<Database>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: SqliteRunRepositoryOptions) {
    mkdirSync(path.dirname(options.filename), { recursive: true });
    this.databasePromise = this.initialize();
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

    return this.enqueueWrite(async (db) => {
      db.run(
        `INSERT INTO runs (
          run_id, agent_kind, game_id, environment_id, profile_id, scenario_id,
          phase, status, created_at, updated_at, config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.runId,
          record.agentKind,
          record.gameId,
          record.environmentId,
          record.profileId ?? null,
          record.scenarioId ?? null,
          record.phase,
          record.status,
          record.createdAt,
          record.updatedAt,
          JSON.stringify(record.config)
        ]
      );

      return record;
    });
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const db = await this.databasePromise;
    const row = this.selectOne(
      db,
      "SELECT * FROM runs WHERE run_id = ?",
      [runId]
    );

    if (!row) {
      return null;
    }

    return this.parseRunRow(row);
  }

  async transitionRun(runId: string, phase: RunPhase, updatedAt: string): Promise<void> {
    const status = deriveRunStatus(phase);

    await this.enqueueWrite(async (db) => {
      db.run(
        "UPDATE runs SET phase = ?, status = ?, updated_at = ? WHERE run_id = ?",
        [phase, status, updatedAt, runId]
      );
    });
  }

  async appendEvent(event: RunEvent): Promise<void> {
    await this.enqueueWrite(async (db) => {
      db.run(
        "INSERT INTO events (event_id, run_id, sequence, timestamp, event_type, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        [event.eventId, event.runId, event.sequence, event.timestamp, event.type, JSON.stringify(event)]
      );
    });
  }

  async listEvents(runId: string): Promise<readonly RunEvent[]> {
    const db = await this.databasePromise;
    const rows = this.selectAll(
      db,
      "SELECT payload_json FROM events WHERE run_id = ? ORDER BY sequence ASC",
      [runId]
    );

    return rows.map((row) => RunEventSchema.parse(JSON.parse(String(row.payload_json))));
  }

  async saveReport(report: RunReport): Promise<void> {
    const parsed = RunReportSchema.parse(report);

    await this.enqueueWrite(async (db) => {
      db.run(
        `INSERT INTO reports (report_id, run_id, generated_at, payload_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET
           report_id = excluded.report_id,
           generated_at = excluded.generated_at,
           payload_json = excluded.payload_json`,
        [parsed.reportId, parsed.runId, parsed.generatedAt, JSON.stringify(parsed)]
      );
    });
  }

  async getReport(runId: string): Promise<RunReport | null> {
    const db = await this.databasePromise;
    const row = this.selectOne(
      db,
      "SELECT payload_json FROM reports WHERE run_id = ?",
      [runId]
    );

    if (!row) {
      return null;
    }

    return RunReportSchema.parse(JSON.parse(String(row.payload_json)));
  }

  private async initialize(): Promise<Database> {
    const wasmPath = fileURLToPath(new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url));
    const SQL = await initSqlJs({
      locateFile: () => wasmPath
    });

    const existing = await this.loadExistingDatabase();
    const database = existing ? new SQL.Database(existing) : new SQL.Database();

    database.run(SQLITE_SCHEMA);
    await this.persist(database);

    return database;
  }

  private async loadExistingDatabase(): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(this.options.filename);
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  private async enqueueWrite<T>(operation: (db: Database) => Promise<T> | T): Promise<T> {
    const runOperation = async (): Promise<T> => {
      const db = await this.databasePromise;
      const result = await operation(db);
      await this.persist(db);
      return result;
    };

    const next = this.writeChain.then(runOperation, runOperation);
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  private async persist(db: Database): Promise<void> {
    await writeFile(this.options.filename, Buffer.from(db.export()));
  }

  private selectOne(db: Database, sql: string, params: readonly SqlBindValue[]): Record<string, unknown> | null {
    const statement = db.prepare(sql, [...params]);

    try {
      if (!statement.step()) {
        return null;
      }

      return statement.getAsObject() as Record<string, unknown>;
    } finally {
      statement.free();
    }
  }

  private selectAll(db: Database, sql: string, params: readonly SqlBindValue[]): Record<string, unknown>[] {
    const statement = db.prepare(sql, [...params]);
    const rows: Record<string, unknown>[] = [];

    try {
      while (statement.step()) {
        rows.push(statement.getAsObject() as Record<string, unknown>);
      }
    } finally {
      statement.free();
    }

    return rows;
  }

  private parseRunRow(row: Record<string, unknown>): RunRecord {
    return RunRecordSchema.parse({
      runId: row.run_id,
      agentKind: row.agent_kind,
      gameId: row.game_id,
      environmentId: row.environment_id,
      ...(row.profile_id ? { profileId: row.profile_id } : {}),
      ...(row.scenario_id ? { scenarioId: row.scenario_id } : {}),
      phase: row.phase,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      config: JSON.parse(String(row.config_json))
    });
  }
}
