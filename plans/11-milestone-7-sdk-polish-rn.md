# Milestone 7: SDK Polish (RN Adapters, Docs, Examples)

## Goal

Polish the React Native SDK experience so setup is predictable across simulators/devices, lifecycle flushing is reliable, and docs/examples are copy-paste usable.

## Principles

- Keep generic SDK core intact.
- Improve RN ergonomics via adapter-layer changes only.
- Prefer simple defaults; keep advanced behavior opt-in.

## Task Breakdown

### Task 7.1: RN adapter API ergonomics

- [ ] Review `initReactNative` API shape for minimum config required.
- [ ] Keep `detachReactNative()` idempotent and safe to call multiple times.
- [ ] Add/confirm support for configurable flush states (`background`, `inactive`, custom).
- [ ] Ensure memory warning hooks are optional and guarded by capability checks.

Acceptance:

- [ ] Adapter can be initialized and detached repeatedly without leaks/errors.
- [ ] Flush triggers are deterministic and test-covered.

### Task 7.2: RN transport defaults and failure behavior

- [ ] Document and enforce sane defaults for batch interval and queue size in RN scenarios.
- [ ] Verify behavior when endpoint is temporarily unreachable (queue bound still enforced).
- [ ] Confirm shutdown/flush semantics for app background and manual teardown.

Acceptance:

- [ ] No unbounded queue growth during network outage.
- [ ] Background transition and manual `flush/shutdown` behavior are consistent.

### Task 7.3: RN networking docs (critical)

- [ ] Add a dedicated RN setup section in `packages/sdk/README.md`:
  - [ ] iOS simulator host usage
  - [ ] Android emulator host mapping
  - [ ] physical device on LAN
- [ ] Include a concise troubleshooting table for common connection failures.
- [ ] Include explicit collector host guidance (`127.0.0.1` vs `0.0.0.0` in dev).

Acceptance:

- [ ] New RN user can connect to local collector without guesswork.

### Task 7.4: RN examples

- [ ] Add small example snippets for:
  - [ ] basic init + log calls
  - [ ] context + `withFlow`
  - [ ] background flush adapter wiring
  - [ ] optional unhandled error capture
- [ ] Keep examples minimal and framework-agnostic (RN + Expo-friendly notes).

Acceptance:

- [ ] Examples are directly reusable in a fresh RN app with minimal edits.

### Task 7.5: Test coverage expansion

- [ ] Add adapter tests for:
  - [ ] custom `flushOnStates`
  - [ ] repeated attach/detach
  - [ ] memory warning callback behavior
  - [ ] no-op behavior when optional RN hooks are missing
- [ ] Keep existing SDK and integration tests green.

Acceptance:

- [ ] `pnpm -C packages/sdk test` and `pnpm -r test` pass with added cases.

## Exit Artifacts

- Updated `packages/sdk/README.md` RN section.
- RN-focused example snippets/files in `packages/sdk`.
- Expanded adapter test coverage and documented behavior contracts.

## Stop Condition

Stop polishing once a new RN project can:

1. wire the SDK in under 10 minutes,
2. ingest to local collector reliably from simulator/device, and
3. observe expected flush behavior on background transitions.
