# Cross-Cutting Requirements

## Event Contract

- [x] Create `packages/core` for shared event types and validation schema.
- [x] Define allowed levels and canonical serialization rules.
- [x] Keep collector, CLI, and SDK imports pointed at core contract.

## Redaction

- [ ] Add collector-side redaction hook for payload keys.
- [ ] Set default redact keys to `email`, `token`, `authorization`, `password`.
- [ ] Configurable via `LOGBOOK_REDACT_KEYS`.
- [ ] Add tests to prevent accidental plain-text secrets in stored payload.

## Deterministic Output

- [x] Stable sort ordering for all grouped CLI output.
- [x] Fixed heading names and section order.
- [x] Stable timestamp formatting.
- [x] No random iteration order from objects/maps.

## Reliability and Ops

- [ ] Graceful shutdown flush behavior documented and tested.
- [ ] Health endpoint reports queue and dropped events.
- [ ] Basic perf sanity test and startup smoke test.
