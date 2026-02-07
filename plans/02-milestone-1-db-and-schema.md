# Milestone 1: DB and Schema

## Goal

Create reliable local SQLite storage with schema/index bootstrap and efficient batch inserts.

## Tasks

- [x] Resolve default DB path for macOS/Linux: `~/.logbook/logs.db`.
- [x] Resolve default DB path for Windows: `%USERPROFILE%\\.logbook\\logs.db`.
- [x] Ensure DB directory exists at startup.
- [x] Open SQLite with `better-sqlite3`.
- [x] Set SQLite pragmas for local durability/perf: `journal_mode=WAL`, `synchronous=NORMAL` (or `FULL` later if needed).
- [x] Create schema bootstrap with `PRAGMA user_version`.
- [x] Create `events` table if missing.
- [x] Create indexes if missing: `idx_events_ts`, `idx_events_name_ts`, `idx_events_device_ts`, `idx_events_flow_ts`, `idx_events_level_ts`.
- [x] Implement DB API functions: `insertEvents(events)`, `queryEvents(filters)`, `deleteOlderThan(tsMs)`, `enforceMaxRows(maxRows)`.
- [x] Use prepared statements and transaction-per-batch.
- [x] Add basic DB tests (bootstrap + insert/query + retention).

## Acceptance Criteria

- [x] Collector startup creates DB directory and file.
- [x] Schema and indexes exist after startup.
- [x] Batch insert of 10k events completes without crash.

## Exit Artifacts

- DB module in `packages/collector`.
- Shared row/event types in `packages/core`.
- Test coverage for schema bootstrap and writes.

## Notes

- To run DB tests locally, `better-sqlite3` native install script must run successfully.
