# Logbook

Logbook is a local, persistent log of application behavior for development.

It replaces ephemeral `console.log` output with structured, searchable, durable event logs stored locally and queryable via a CLI. Logbook is designed to make app behavior legible during development and debugging, including multi-device testing and LLM-assisted diagnosis.

Logbook is not a production observability platform.

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
globalThis.log = log
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
