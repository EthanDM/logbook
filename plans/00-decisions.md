# Decisions and Adjustments

This reflects agreement with your milestone plan, with small implementation clarifications to reduce rework.

## Agreed Direction

- Keep Fastify.
- Keep SQLite as local source of truth.
- Keep CLI reading SQLite directly.
- Keep SDK after collector and CLI value is proven.

## Adjustments

- Day 1 should include only collector ingest, `logbook dev`, `logbook tail`, and `logbook summary --since 5m`.
- Backpressure policy should be explicit early with `drop_oldest` and dropped-count reporting in `/health`.
- Validation should use shared schema/types in `packages/core` from day one to avoid drift.
- Retention defaults should be set early to `RETENTION_HOURS=24`, `MAX_ROWS=200000`, with a 60s cleanup interval.
- Deterministic CLI output rules should be fixed before summary implementation (stable sort keys, fixed headings, fixed time format).

## Open Choices

- CLI framework: `commander` vs `cac`
- Time expression parser package vs custom parser
- Whether to print LAN IP automatically in `logbook dev`
