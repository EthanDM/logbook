# Milestone 4: SDK (RN-First, Generic Core)

## Goal

Provide structured app-side logging with batching, context, and flow support.

## Tasks

- [ ] Create `packages/sdk` with TS public API: `init(config)`, `log.info`, `log.warn`, `log.error`, optional `log.debug`.
- [ ] Implement transport queue with periodic batch POST (`250ms`).
- [ ] Bound SDK queue (default `5000`).
- [ ] Add best-effort flush on background/unload hooks.
- [ ] Implement context with `setContext(partial)` and merge into subsequent events.
- [ ] Implement flow helper `withFlow(flowId, fn)` with best-effort async-safe behavior.
- [ ] Add optional dev global exposure via `init({ devGlobal: true, globalName: "log" })`.
- [ ] Add opt-in unhandled error capture for `js.unhandled_error` and `js.unhandled_rejection`.

## Acceptance Criteria

- [ ] Simple app/test can emit `log.info` and collector receives it.
- [ ] Context fields appear on subsequent events.
- [ ] `withFlow` groups related events under same `flowId`.
- [ ] Error capture emits expected event names when enabled.

## Exit Artifacts

- SDK package docs and examples.
- Integration test against running local collector.
