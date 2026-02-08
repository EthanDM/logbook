# Logbook

Logbook is a local, persistent log of application behavior for development.

It replaces ephemeral `console.log` output with structured, searchable, durable event logs stored locally and queryable via a CLI. Logbook is designed to make app behavior legible during development and debugging, including multi-device testing and LLM-assisted diagnosis.

Logbook is not a production observability platform.

## Getting Started In 60s

Requirements:

- Node `22+`
- `pnpm`

```sh
pnpm install
pnpm -r build
```

Terminal 1 (start collector):

```sh
pnpm -C packages/cli dev
```

Terminal 2 (send one event):

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"ts":1738890000000,"level":"info","name":"demo.hello","payload":{"x":1}}'
```

Terminal 2 (read logs):

```sh
./packages/cli/dist/bin.js tail --json --limit 20
./packages/cli/dist/bin.js summary --since 5m
```

## Problem Statement

During development, application logs are often:

- Ephemeral (lost on restart)
- Fragmented across tools (terminal, simulator, device logs)
- Unstructured (hard to search or correlate)
- Difficult to summarize or reason about after the fact

This makes answering basic questions slow and error-prone:

- What just happened?
- Why did this screen update twice?
- What events occurred right before this error?
- How does this flow behave across devices?

Logbook exists to solve this locally, with minimal setup and zero cloud dependency.

## What Logbook Is

Logbook is:

- A local system of record for development logs
- Event-based, not line-based
- Persistent across app and terminal restarts
- Queryable via a CLI
- LLM-friendly (structured output, summaries, slices)
- Framework-agnostic (RN-first, but not RN-only)

## What Logbook Is Not

Logbook is not:

- A production observability platform
- A metrics system
- A tracing system (in the OpenTelemetry sense)
- A replacement for Sentry, Datadog, Mezmo, etc.
- A UI-heavy dashboard or analytics tool

If you need alerts, SLAs, or production-scale ingestion, Logbook is the wrong tool.

## Core Concepts

### Event (Fundamental Unit)

Logbook stores events, not raw strings.

Each event represents something meaningful that happened in the app.

```json
{
  "ts": 1738890000000,
  "level": "info",
  "name": "feed.refresh",
  "deviceId": "iphone-15-pro",
  "sessionId": "s_abc123",
  "flowId": "f_refresh_001",
  "screen": "Feed",
  "payload": {
    "reason": "pull_to_refresh",
    "cached": false
  }
}
```

### Persistence

All events are written to a local SQLite database.

- Logs survive app restarts
- Logs survive terminal restarts
- Logs can be queried retroactively
- Logs can be summarized or exported

Retention is configurable (time-based or count-based).

### Correlation (Flows)

Events may optionally belong to a flow (`flowId`).

A flow represents a causal chain of events, such as:

- User action -> network request -> response -> state update -> navigation
- App launch -> auth -> hydration -> home screen render

Flows are lightweight and string-based, not full distributed traces.

## Architecture Overview

```text
App / SDK
   |
   | (HTTP JSON events, batched)
   v
Logbook Collector (local)
   |
   | (batched inserts)
   v
SQLite (logs.db)
   |
   +-- CLI queries (tail, find, flow, summary)
   +-- Optional future UI
```

## Components

### 1. Collector

A local process responsible for:

- Accepting log events over HTTP
- Buffering events in memory
- Batch-writing events to SQLite
- Enforcing retention policies

Characteristics:

- Single process
- Local-only
- No auth
- Optimized for development, not production

Runtime behavior:

- Flushes queued events to SQLite every `250ms` or when queue length reaches `200`.
- Uses bounded queue backpressure with `drop_oldest` when queue exceeds max size.
- Flushes queued events during graceful shutdown before closing the DB.
- Exposes lifecycle, queue, dropped counts, and flush/retention status on `GET /health`.
- Redacts sensitive payload keys before persistence. Defaults: `email`, `token`, `authorization`, `password`; configurable with `LOGBOOK_REDACT_KEYS`.

Collector environment variables:

| Variable                        | Default                              | Purpose                                                            |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `LOGBOOK_HOST`                  | `127.0.0.1`                          | Collector bind host.                                               |
| `LOGBOOK_PORT`                  | `8787`                               | Collector bind port.                                               |
| `LOGBOOK_DB_PATH`               | platform default                     | SQLite file path.                                                  |
| `LOGBOOK_RETENTION_HOURS`       | `24`                                 | Delete rows older than this many hours.                            |
| `LOGBOOK_MAX_ROWS`              | `200000`                             | Maximum retained rows after cleanup.                               |
| `LOGBOOK_FLUSH_INTERVAL_MS`     | `250`                                | Flush queue cadence in milliseconds.                               |
| `LOGBOOK_FLUSH_BATCH_SIZE`      | `200`                                | Number of events inserted per DB flush batch.                      |
| `LOGBOOK_FLUSH_QUEUE_THRESHOLD` | `200`                                | Flush immediately once queue reaches this size.                    |
| `LOGBOOK_MAX_QUEUE_SIZE`        | `50000`                              | Max in-memory queue size before dropping oldest events.            |
| `LOGBOOK_RETENTION_INTERVAL_MS` | `60000`                              | Cleanup interval in milliseconds.                                  |
| `LOGBOOK_SHUTDOWN_TIMEOUT_MS`   | `5000`                               | Max shutdown drain window before dropping remaining queued events. |
| `LOGBOOK_REDACT_KEYS`           | `email,token,authorization,password` | Comma-separated payload keys to redact before persistence.         |

`LOGBOOK_DB_PATH` platform defaults:

- macOS/Linux: `~/.logbook/logs.db`
- Windows: `%USERPROFILE%\.logbook\logs.db`

CLI `logbook dev` flags (`--host`, `--port`, `--db`) override these values.

Collector benchmark:

```sh
pnpm -C packages/collector bench:ingest
```

Benchmark env knobs:

- `LOGBOOK_BENCH_EVENTS` (default `20000`)
- `LOGBOOK_BENCH_BATCH_SIZE` (default `200`)
- `LOGBOOK_BENCH_CONCURRENCY` (default `4`)
- `LOGBOOK_BENCH_WAIT_TIMEOUT_MS` (default `60000`)

Reference baseline (captured on February 8, 2026 in this repository):

- `events_total=20000`
- `enqueue_throughput_eps=100533.35`
- `end_to_end_throughput_eps=99989.31`
- `dropped_events=0`
- `flush_failures=0`

Operations and tuning guide: `docs/collector-operations.md`

### 2. SQLite Storage

The SQLite database is the source of truth.

Minimum schema:

```sql
CREATE TABLE events (
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
```

Minimum indexes:

- `(ts)`
- `(name, ts)`
- `(device_id, ts)`
- `(flow_id, ts)`
- `(level, ts)`

### 3. CLI (Primary Interface)

Logbook is CLI-first.

The CLI queries SQLite directly and prints deterministic, compact output suitable for humans and LLMs.

Core commands:

`logbook dev`

- Starts the local collector
- Prints local UI/ingest URL
- Prints LAN ingest URL (for physical devices)
- Ensures the database exists

`logbook web`

- Starts collector and prints a local Web UI URL
- Starts `packages/web` dev server automatically when present
- Falls back to explicit manual command if auto-start is unavailable

`logbook tail`

- Shows most recent events
- Supports `--level`, `--name`, `--device`
- Supports optional `--follow`

`logbook find`

- Queries historical events
- Supports `--since`, `--until`, `--name`, `--level`, `--device`, `--flow`

`logbook flow <flowId>`

- Shows all events in a flow, ordered by time
- Primary tool for debugging behavior

`logbook summary --since 5m`

- Shows grouped counts by event name
- Shows recent errors
- Shows recent flows
- Designed for LLM consumption

`logbook around <eventId> --window 5s`

- Shows events before and after a specific event
- Useful for contextual debugging

### 4. Web UI (Optional, Local MVP)

The web package is a local dashboard for exploratory debugging.

```sh
pnpm -C packages/web dev
```

By default it proxies `/api/*` to `http://127.0.0.1:8787`.
Override target with `LOGBOOK_WEB_API_TARGET`.

## SDK (Application Logger)

Applications emit logs via a structured logger, not `console.log`.

The SDK:

- Batches events
- Sends them to the local collector
- Attaches context automatically
- Never blocks app execution

Minimal API:

```ts
init({
  endpoint: "http://<dev-machine>:8787/ingest",
  app: "my-app",
});

log.info(name, payload?);
log.warn(name, payload?);
log.error(name, payload?, error?);

log.withFlow(flowId, fn);
log.setContext({ screen: "Feed" });
```

Development convenience:

```ts
globalThis.log = log;
```

This is optional and dev-only.

## Design Principles

1. Local-first: no cloud, no accounts, no auth.
2. Persistent by default: logs are a record, not a stream.
3. Structured over strings: events over lines.
4. CLI-first: UI is optional and secondary.
5. LLM-friendly: deterministic output, compact summaries, structured slices.
6. Low ceremony: minimal setup with no config required for first use.

## Explicit Non-Goals

Logbook will not:

- Implement OpenTelemetry
- Collect metrics or histograms
- Provide alerting
- Ship a production SaaS
- Replace native debuggers
- Become a general observability platform

## Intended Use Cases

- Debugging complex app flows
- Multi-device development
- Understanding "what just happened"
- Exporting logs for teammates
- Feeding logs into Codex / LLMs for diagnosis

## Roadmap (Non-Binding)

- RN SDK (first-class)
- Web UI (optional)
- Console log capture (opt-in)
- Log export formats
- Redaction hooks

## License

MIT
