# Milestone 2: Collector and Ingest

## Goal

Run a robust local Fastify collector that accepts events, enqueues quickly, and flushes to SQLite asynchronously.

## Tasks

- [ ] Create Fastify server in `packages/collector`.
- [ ] Default bind host to `127.0.0.1`, port `8787`.
- [ ] Add configuration for host, port, db path, queue options, retention.
- [ ] Implement routes: `POST /ingest` (single event or array) and `GET /health` (status, db path, queue size, drop count).
- [ ] Implement validation with required fields `ts`, `level`, `name` and optional fields `deviceId`, `sessionId`, `flowId`, `screen`, `payload`, `msg`.
- [ ] Add bounded queue: flush every `250ms` or queue length `>= 200`, max queue size `50000`, drop policy `drop_oldest` (documented).
- [ ] Ensure HTTP response returns after enqueue, not after DB flush.
- [ ] Add flush loop with transaction writes.
- [ ] Add retention job every `60s`: delete by retention hours, then enforce max rows if still above limit.
- [ ] Handle graceful shutdown: stop intake, flush remaining queue, close DB cleanly.

## Acceptance Criteria

- [ ] `curl http://127.0.0.1:8787/health` returns JSON OK.
- [ ] Invalid payload returns `400` with readable error.
- [ ] High-rate ingest does not stall request handling.
- [ ] Retention removes old rows with low configured limits.

## Exit Artifacts

- Collector package with runnable `startCollector()`.
- Health payload includes queue and drop metrics.
- Basic integration tests for ingest + retention.
