# Milestone 1: DB and Schema

## Goal

Create reliable local SQLite storage with schema/index bootstrap and efficient batch inserts.

## Tasks

- [ ] Resolve default DB path for macOS/Linux: `~/.logbook/logs.db`.
- [ ] Resolve default DB path for Windows: `%USERPROFILE%\\.logbook\\logs.db`.
- [ ] Ensure DB directory exists at startup.
- [ ] Open SQLite with `better-sqlite3`.
- [ ] Set SQLite pragmas for local durability/perf: `journal_mode=WAL`, `synchronous=NORMAL` (or `FULL` later if needed).
- [ ] Create schema bootstrap with `PRAGMA user_version`.
- [ ] Create `events` table if missing.
- [ ] Create indexes if missing: `idx_events_ts`, `idx_events_name_ts`, `idx_events_device_ts`, `idx_events_flow_ts`, `idx_events_level_ts`.
- [ ] Implement DB API functions: `insertEvents(events)`, `queryEvents(filters)`, `deleteOlderThan(tsMs)`, `enforceMaxRows(maxRows)`.
- [ ] Use prepared statements and transaction-per-batch.
- [ ] Add basic DB tests (bootstrap + insert/query + retention).

## Acceptance Criteria

- [ ] Collector startup creates DB directory and file.
- [ ] Schema and indexes exist after startup.
- [ ] Batch insert of 10k events completes without crash.

## Exit Artifacts

- DB module in `packages/collector`.
- Shared row/event types in `packages/core`.
- Test coverage for schema bootstrap and writes.
