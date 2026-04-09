export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  agent_kind TEXT NOT NULL,
  game_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  profile_id TEXT,
  scenario_id TEXT,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_run_id_sequence ON events(run_id, sequence);

CREATE TABLE IF NOT EXISTS reports (
  report_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
`;
