import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import BetterSqlite3 from "better-sqlite3";
import { LogbookDatabase } from "../src/db/database.js";
import {
  ensureDbDirectory,
  resolveDefaultDbPath,
  resolveDefaultLogbookDir,
} from "../src/db/db-path.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

test("resolves platform default paths", () => {
  const posixHome = "/tmp/demo-home";
  const posixDir = resolveDefaultLogbookDir({
    platform: "darwin",
    homeDir: posixHome,
  });
  const posixDbPath = resolveDefaultDbPath({
    platform: "darwin",
    homeDir: posixHome,
  });

  assert.equal(posixDir, join(posixHome, ".logbook"));
  assert.equal(posixDbPath, join(posixHome, ".logbook", "logs.db"));

  const windowsDir = resolveDefaultLogbookDir({
    platform: "win32",
    env: { USERPROFILE: "C:\\Users\\demo" },
  });

  assert.equal(windowsDir, join("C:\\Users\\demo", ".logbook"));
});

test("ensureDbDirectory creates directory recursively", () => {
  const root = createTempDir("logbook-db-path-");
  const dbPath = join(root, "nested", ".logbook", "logs.db");

  assert.doesNotThrow(() => ensureDbDirectory(dbPath));

  cleanupDir(root);
});

test("bootstraps schema and indexes on first open", () => {
  const root = createTempDir("logbook-db-schema-");
  const dbPath = join(root, "logs.db");

  const database = new LogbookDatabase({ dbPath });
  database.close();

  const sqlite = new BetterSqlite3(dbPath, { readonly: true });
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events';",
    )
    .get() as { name?: string } | undefined;
  assert.equal(table?.name, "events");

  const indexes = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events';",
    )
    .all() as Array<{ name: string }>;
  const indexNames = new Set(indexes.map((row) => row.name));

  assert.ok(indexNames.has("idx_events_ts"));
  assert.ok(indexNames.has("idx_events_name_ts"));
  assert.ok(indexNames.has("idx_events_device_ts"));
  assert.ok(indexNames.has("idx_events_flow_ts"));
  assert.ok(indexNames.has("idx_events_level_ts"));

  sqlite.close();
  cleanupDir(root);
});

test("inserts and queries events with filters", () => {
  const root = createTempDir("logbook-db-query-");
  const dbPath = join(root, "logs.db");
  const database = new LogbookDatabase({ dbPath });

  const inserted = database.insertEvents([
    {
      ts: 1000,
      level: "info",
      name: "feed.refresh",
      deviceId: "iphone",
      flowId: "flow-a",
      payload: { reason: "pull_to_refresh" },
    },
    {
      ts: 2000,
      level: "warn",
      name: "feed.refresh",
      deviceId: "iphone",
      flowId: "flow-a",
      msg: "slow response",
    },
    {
      ts: 3000,
      level: "error",
      name: "feed.error",
      deviceId: "android",
      flowId: "flow-b",
      msg: "request failed",
    },
  ]);

  assert.equal(inserted, 3);

  const flowRows = database.queryEvents({
    flowId: "flow-a",
    order: "asc",
    limit: 10,
  });
  assert.equal(flowRows.length, 2);
  assert.equal(flowRows[0]?.name, "feed.refresh");
  assert.equal(flowRows[1]?.level, "warn");

  const errorRows = database.queryEvents({
    levels: ["error"],
    limit: 5,
  });
  assert.equal(errorRows.length, 1);
  assert.equal(errorRows[0]?.name, "feed.error");

  database.close();
  cleanupDir(root);
});

test("retention helpers delete rows by age and max row count", () => {
  const root = createTempDir("logbook-db-retention-");
  const dbPath = join(root, "logs.db");
  const database = new LogbookDatabase({ dbPath });

  const events = Array.from({ length: 10 }, (_, index) => ({
    ts: index + 1,
    level: "info" as const,
    name: `demo.${index}`,
  }));

  database.insertEvents(events);
  assert.equal(database.getTotalEventsCount(), 10);

  const deletedByAge = database.deleteOlderThan(6);
  assert.equal(deletedByAge, 5);
  assert.equal(database.getTotalEventsCount(), 5);

  const deletedByMax = database.enforceMaxRows(2);
  assert.equal(deletedByMax, 3);
  assert.equal(database.getTotalEventsCount(), 2);

  database.close();
  cleanupDir(root);
});

test("queryAroundEvent returns surrounding rows for an event window", () => {
  const root = createTempDir("logbook-db-around-");
  const dbPath = join(root, "logs.db");
  const database = new LogbookDatabase({ dbPath });

  database.insertEvents([
    { ts: 1_000, level: "info", name: "demo.a" },
    { ts: 2_000, level: "info", name: "demo.b" },
    { ts: 3_000, level: "info", name: "demo.c" },
  ]);

  const middleEvent = database
    .queryEvents({ name: "demo.b", order: "asc", limit: 1 })
    .at(0);
  assert.ok(middleEvent);

  const around = database.queryAroundEvent(middleEvent.id, 1_100);
  assert.equal(around.length, 3);
  assert.equal(around[0]?.name, "demo.a");
  assert.equal(around[2]?.name, "demo.c");

  database.close();
  cleanupDir(root);
});

test("handles 10k inserts in one batch", () => {
  const root = createTempDir("logbook-db-batch-");
  const dbPath = join(root, "logs.db");
  const database = new LogbookDatabase({ dbPath });

  const events = Array.from({ length: 10_000 }, (_, index) => ({
    ts: 1_000_000 + index,
    level: "info" as const,
    name: "batch.event",
    sessionId: "session-1",
  }));

  const inserted = database.insertEvents(events);
  assert.equal(inserted, 10_000);
  assert.equal(database.getTotalEventsCount(), 10_000);

  database.close();
  cleanupDir(root);
});
