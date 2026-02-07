# Milestone 3: CLI Core

## Goal

Ship a deterministic, SQLite-backed CLI that is useful for debugging without requiring collector RPC.

## Tasks

- [x] Set up `packages/cli` binary as `logbook`.
- [x] Share DB path resolution logic with collector.
- [x] Implement `logbook dev`: start collector, print local URL and ingest endpoint, support `--host`, `--port`, `--db`, and handle `Ctrl+C` clean shutdown.
- [x] Implement `logbook tail`: default last `50`, support filters (`--level`, `--name`, `--device`), support text and `--json` (NDJSON), and support `--follow` polling every `500ms`.
- [x] Implement `logbook find`: support filters and time range (`--since`, `--until`), `--limit` default `200`, and text/JSON output.
- [x] Implement `logbook summary --since` with deterministic sections: totals/devices/range, top names, grouped errors, recent flows, and optional `--md`.
- [x] Implement `logbook flow <flowId>`.
- [x] Implement `logbook around <eventId> --window 5s`.
- [x] Enforce deterministic sorting in all outputs.

## Acceptance Criteria

- [x] `logbook --help` lists commands.
- [x] `logbook dev` starts and stops cleanly.
- [x] `logbook tail --follow` behaves as expected.
- [x] `logbook summary --since 5m` produces stable sections.

## Exit Artifacts

- CLI package with command docs.
- Snapshot tests for deterministic summary output.

## Notes

- `logbook` command is currently executed through `pnpm -C packages/cli dev ...` in local development.
