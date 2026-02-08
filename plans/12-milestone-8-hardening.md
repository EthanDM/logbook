# Milestone 8: Hardening (Shutdown, Ops Docs, CI Matrix)

## Goal

Improve reliability and maintainability before broader adoption by hardening shutdown behavior, documenting retention/backpressure operations, and strengthening CI coverage.

## Current Baseline

- [x] Collector flushes queue on close.
- [x] Queue backpressure uses `drop_oldest`.
- [x] Retention loop enforces time + max-row cleanup.
- [x] CI runs build/typecheck/test on Ubuntu Node 22.

## Task Breakdown

### Task 8.1: Graceful shutdown hardening

- [x] Ensure `logbook dev` and collector shutdown paths handle `SIGINT` and `SIGTERM` exactly once.
- [x] Add explicit shutdown state to reject new ingest during teardown with clear response.
- [x] Add bounded shutdown timeout and deterministic fallback behavior.
- [x] Add tests for repeated close calls and signal-driven shutdown.

Acceptance:

- [x] No event loss on normal shutdown with queued events.
- [x] No hangs on repeated signals; process exits predictably.

### Task 8.2: Retention and backpressure operational docs

- [x] Add a dedicated operations doc (for example `docs/collector-operations.md`).
- [x] Document queue controls, drop policy, flush cadence, and retention settings.
- [x] Document health fields (`queue`, `stats`, failures) and how to interpret them.
- [x] Add practical tuning presets for low, medium, and high ingest rates.

Acceptance:

- [x] A new user can tune retention/backpressure without reading source code.

### Task 8.3: Health/status hardening

- [x] Extend health payload with lifecycle data (startup time, last successful flush/retention timestamps).
- [x] Track and expose last flush/retention error summaries (safe, non-sensitive).
- [x] Add tests for health payload stability and deterministic keys.

Acceptance:

- [x] `/health` is sufficient to debug stuck queue and retention failure scenarios.

### Task 8.4: CI matrix expansion

- [x] Expand CI to Node `22` and Node `24`.
- [x] Keep native dependency reliability (`better-sqlite3` rebuild) in all relevant jobs.
- [x] Add at least one non-Linux lane (macOS) for native binding confidence.
- [x] Keep runtime reasonable by splitting fast checks vs full test lanes if needed.

Acceptance:

- [x] Matrix is green and stable across configured runtimes.

### Task 8.5: Hardening smoke checks in CI

- [x] Add a small collector ingest smoke/benchmark gate with fixed thresholds.
- [x] Add CLI smoke command sequence in CI using temp DB.
- [x] Fail fast with clear diagnostics on regressions.

Acceptance:

- [x] CI catches regressions in ingest throughput and shutdown safety early.

## Quality Gates

- [x] `pnpm -r build` passes.
- [x] `pnpm -r typecheck` passes.
- [x] `pnpm -r test` passes.
- [x] New docs linked from root `README.md`.

## Stop Condition

Stop hardening once:

1. shutdown and signal behavior are deterministic,
2. retention/backpressure tuning is clearly documented,
3. CI matrix validates core flows across target runtimes.
