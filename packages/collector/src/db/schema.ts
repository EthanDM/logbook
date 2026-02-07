import type BetterSqlite3 from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 1;

const CREATE_EVENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  name TEXT NOT NULL,
  device_id TEXT,
  session_id TEXT,
  flow_id TEXT,
  screen TEXT,
  msg TEXT,
  payload_json TEXT
);
`;

const CREATE_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);",
  "CREATE INDEX IF NOT EXISTS idx_events_name_ts ON events(name, ts);",
  "CREATE INDEX IF NOT EXISTS idx_events_device_ts ON events(device_id, ts);",
  "CREATE INDEX IF NOT EXISTS idx_events_flow_ts ON events(flow_id, ts);",
  "CREATE INDEX IF NOT EXISTS idx_events_level_ts ON events(level, ts);",
];

interface TableInfoRow {
  name: string;
}

export function ensureSchema(db: BetterSqlite3.Database): void {
  const currentVersion = Number(db.pragma("user_version", { simple: true })) || 0;

  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${currentVersion}. Max supported is ${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  db.exec(CREATE_EVENTS_TABLE_SQL);
  ensureMsgColumn(db);

  for (const sql of CREATE_INDEX_SQL) {
    db.exec(sql);
  }

  if (currentVersion < CURRENT_SCHEMA_VERSION) {
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
  }
}

function ensureMsgColumn(db: BetterSqlite3.Database): void {
  const rows = db.prepare("PRAGMA table_info(events);").all() as TableInfoRow[];
  const hasMsgColumn = rows.some((row) => row.name === "msg");

  if (!hasMsgColumn) {
    db.exec("ALTER TABLE events ADD COLUMN msg TEXT;");
  }
}

