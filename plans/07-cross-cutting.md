# Cross-Cutting Requirements

## Event Contract

- [ ] Create `packages/core` for shared event types and validation schema.
- [ ] Define allowed levels and canonical serialization rules.
- [ ] Keep collector, CLI, and SDK imports pointed at core contract.

## Redaction

- [ ] Add collector-side redaction hook for payload keys.
- [ ] Set default redact keys to `email`, `token`, `authorization`, `password`.
- [ ] Configurable via `LOGBOOK_REDACT_KEYS`.
- [ ] Add tests to prevent accidental plain-text secrets in stored payload.

## Deterministic Output

- [ ] Stable sort ordering for all grouped CLI output.
- [ ] Fixed heading names and section order.
- [ ] Stable timestamp formatting.
- [ ] No random iteration order from objects/maps.

## Reliability and Ops

- [ ] Graceful shutdown flush behavior documented and tested.
- [ ] Health endpoint reports queue and dropped events.
- [ ] Basic perf sanity test and startup smoke test.
