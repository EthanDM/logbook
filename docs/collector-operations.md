# Collector Operations

This document explains how to tune collector durability, queue behavior, and cleanup.

## Runtime Model

- Ingest requests are accepted over HTTP and put into an in-memory queue.
- Queue is flushed to SQLite in batches.
- Retention runs periodically to remove old rows and enforce max row count.
- Shutdown stops new ingest, flushes remaining queue (bounded by timeout), then closes DB.

## Queue And Flush Controls

These settings control write behavior and backpressure:

| Variable | Default | Effect |
| --- | --- | --- |
| `LOGBOOK_FLUSH_INTERVAL_MS` | `250` | Periodic flush cadence. |
| `LOGBOOK_FLUSH_BATCH_SIZE` | `200` | Rows inserted per SQLite batch. |
| `LOGBOOK_FLUSH_QUEUE_THRESHOLD` | `200` | Immediate flush trigger when queue reaches this size. |
| `LOGBOOK_MAX_QUEUE_SIZE` | `50000` | Hard queue cap. |

Backpressure policy:

- Drop policy is `drop_oldest`.
- If queue is full, oldest events are discarded to make room for new events.
- During forced shutdown timeout, any remaining queued events are dropped and counted in `stats.shutdownDroppedEvents`.

## Retention Controls

| Variable | Default | Effect |
| --- | --- | --- |
| `LOGBOOK_RETENTION_HOURS` | `24` | Time-based cleanup threshold. |
| `LOGBOOK_MAX_ROWS` | `200000` | Count-based cap after time cleanup. |
| `LOGBOOK_RETENTION_INTERVAL_MS` | `60000` | Retention job cadence. |

Retention order:

1. Delete rows older than retention hours.
2. If row count is still above max rows, delete oldest rows until below cap.

## Shutdown Controls

| Variable | Default | Effect |
| --- | --- | --- |
| `LOGBOOK_SHUTDOWN_TIMEOUT_MS` | `5000` | Max time to drain queue during shutdown before fallback drop. |

Shutdown behavior:

1. Collector enters `stopping` lifecycle state.
2. New `POST /ingest` requests are rejected with `503`.
3. Queue is flushed until drained or timeout.
4. On timeout, remaining queued events are dropped and counted.
5. DB is closed and lifecycle moves to `stopped`.

## Health Payload Interpretation

`GET /health` exposes operational state:

- `lifecycle`
  - `state`: `running` | `stopping` | `stopped`
  - `startedAtMs`, `shutdownStartedAtMs`
  - `shutdownTimeoutMs`
  - `lastSuccessfulFlushAtMs`
  - `lastSuccessfulRetentionAtMs`
- `queue`
  - `length`, `maxSize`, `dropPolicy`
- `stats`
  - `acceptedEvents`
  - `droppedEvents`
  - `shutdownDroppedEvents`
  - `flushFailures`
  - `retentionFailures`
- `failures`
  - `lastFlushError`
  - `lastRetentionError`

Quick diagnostics:

- Growing `queue.length` + stale `lastSuccessfulFlushAtMs` => flush path is blocked/failing.
- Increasing `retentionFailures` or non-null `lastRetentionError` => cleanup is failing.
- Large `droppedEvents` => queue pressure exceeds current tuning.
- Non-zero `shutdownDroppedEvents` => shutdown timeout too short for queue volume.

## Tuning Presets

Start with defaults, then tune by ingest volume.

### Low ingest (single app, occasional events)

- `LOGBOOK_FLUSH_INTERVAL_MS=500`
- `LOGBOOK_FLUSH_BATCH_SIZE=100`
- `LOGBOOK_FLUSH_QUEUE_THRESHOLD=100`
- `LOGBOOK_MAX_QUEUE_SIZE=10000`
- `LOGBOOK_RETENTION_HOURS=24`
- `LOGBOOK_MAX_ROWS=100000`

### Medium ingest (multiple simulators/devices)

- `LOGBOOK_FLUSH_INTERVAL_MS=250`
- `LOGBOOK_FLUSH_BATCH_SIZE=200`
- `LOGBOOK_FLUSH_QUEUE_THRESHOLD=200`
- `LOGBOOK_MAX_QUEUE_SIZE=50000`
- `LOGBOOK_RETENTION_HOURS=24`
- `LOGBOOK_MAX_ROWS=200000`

### High ingest (stress testing and load bursts)

- `LOGBOOK_FLUSH_INTERVAL_MS=100`
- `LOGBOOK_FLUSH_BATCH_SIZE=500`
- `LOGBOOK_FLUSH_QUEUE_THRESHOLD=500`
- `LOGBOOK_MAX_QUEUE_SIZE=100000`
- `LOGBOOK_RETENTION_HOURS=12`
- `LOGBOOK_MAX_ROWS=500000`
- `LOGBOOK_SHUTDOWN_TIMEOUT_MS=10000`
