# Milestone 2: Collector and Ingest

## Goal

Run a robust local Fastify collector that accepts events, enqueues quickly, and flushes to SQLite asynchronously.

## Tasks

- [x] Create Fastify server in `packages/collector`.
- [x] Default bind host to `127.0.0.1`, port `8787`.
- [x] Add configuration for host, port, db path, queue options, retention.
- [x] Implement routes: `POST /ingest` (single event or array) and `GET /health` (status, db path, queue size, drop count).
- [x] Implement validation with required fields `ts`, `level`, `name` and optional fields `deviceId`, `sessionId`, `flowId`, `screen`, `payload`, `msg`.
- [x] Add bounded queue: flush every `250ms` or queue length `>= 200`, max queue size `50000`, drop policy `drop_oldest` (documented).
- [x] Ensure HTTP response returns after enqueue, not after DB flush.
- [x] Add flush loop with transaction writes.
- [x] Add retention job every `60s`: delete by retention hours, then enforce max rows if still above limit.
- [x] Handle graceful shutdown: stop intake, flush remaining queue, close DB cleanly.

## Acceptance Criteria

- [x] `curl http://127.0.0.1:8787/health` returns JSON OK.
- [x] Invalid payload returns `400` with readable error.
- [x] High-rate ingest does not stall request handling.
- [x] Retention removes old rows with low configured limits.

## Exit Artifacts

- Collector package with runnable `startCollector()`.
- Health payload includes queue and drop metrics.
- Basic integration tests for ingest + retention.

## Notes

- Integration tests use Fastify `inject` to validate the same behavior as HTTP endpoints.
