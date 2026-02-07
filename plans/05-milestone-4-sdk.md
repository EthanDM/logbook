# Milestone 4: SDK (RN-First, Generic Core)

## Goal

Provide structured app-side logging with batching, context, and flow support.

## Tasks

- [x] Create `packages/sdk` with TS public API: `init(config)`, `log.info`, `log.warn`, `log.error`, optional `log.debug`.
- [x] Implement transport queue with periodic batch POST (`250ms`).
- [x] Bound SDK queue (default `5000`).
- [x] Add best-effort flush on background/unload hooks.
- [x] Implement context with `setContext(partial)` and merge into subsequent events.
- [x] Implement flow helper `withFlow(flowId, fn)` with best-effort async-safe behavior.
- [x] Add optional dev global exposure via `init({ devGlobal: true, globalName: "log" })`.
- [x] Add opt-in unhandled error capture for `js.unhandled_error` and `js.unhandled_rejection`.

## Acceptance Criteria

- [x] Simple app/test can emit `log.info` and collector receives it.
- [x] Context fields appear on subsequent events.
- [x] `withFlow` groups related events under same `flowId`.
- [x] Error capture emits expected event names when enabled.

## Exit Artifacts

- SDK package docs and examples.
- Integration test against running local collector.

## Notes

- Unhandled capture tests invoke installed handlers directly to avoid destabilizing the Node test runner with real unhandled events.
