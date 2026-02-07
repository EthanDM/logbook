# Milestone 3: CLI Core

## Goal

Ship a deterministic, SQLite-backed CLI that is useful for debugging without requiring collector RPC.

## Tasks

- [ ] Set up `packages/cli` binary as `logbook`.
- [ ] Share DB path resolution logic with collector.
- [ ] Implement `logbook dev`: start collector, print local URL and ingest endpoint, support `--host`, `--port`, `--db`, and handle `Ctrl+C` clean shutdown.
- [ ] Implement `logbook tail`: default last `50`, support filters (`--level`, `--name`, `--device`), support text and `--json` (NDJSON), and support `--follow` polling every `500ms`.
- [ ] Implement `logbook find`: support filters and time range (`--since`, `--until`), `--limit` default `200`, and text/JSON output.
- [ ] Implement `logbook summary --since` with deterministic sections: totals/devices/range, top names, grouped errors, recent flows, and optional `--md`.
- [ ] Implement `logbook flow <flowId>`.
- [ ] Implement `logbook around <eventId> --window 5s`.
- [ ] Enforce deterministic sorting in all outputs.

## Acceptance Criteria

- [ ] `logbook --help` lists commands.
- [ ] `logbook dev` starts and stops cleanly.
- [ ] `logbook tail --follow` behaves as expected.
- [ ] `logbook summary --since 5m` produces stable sections.

## Exit Artifacts

- CLI package with command docs.
- Snapshot tests for deterministic summary output.
