# Milestone 7: SDK Polish (RN Adapters, Docs, Examples)

## Goal

Polish the React Native SDK experience so setup is predictable across simulators/devices, lifecycle flushing is reliable, and docs/examples are copy-paste usable.

## Principles

- Keep generic SDK core intact.
- Improve RN ergonomics via adapter-layer changes only.
- Prefer simple defaults; keep advanced behavior opt-in.

## Task Breakdown

### Task 7.1: RN adapter API ergonomics

- [x] Review `initReactNative` API shape for minimum config required.
- [x] Keep `detachReactNative()` idempotent and safe to call multiple times.
- [x] Add/confirm support for configurable flush states (`background`, `inactive`, custom).
- [x] Ensure memory warning hooks are optional and guarded by capability checks.

Acceptance:

- [x] Adapter can be initialized and detached repeatedly without leaks/errors.
- [x] Flush triggers are deterministic and test-covered.

### Task 7.2: RN transport defaults and failure behavior

- [x] Document and enforce sane defaults for batch interval and queue size in RN scenarios.
- [x] Verify behavior when endpoint is temporarily unreachable (queue bound still enforced).
- [x] Confirm shutdown/flush semantics for app background and manual teardown.

Acceptance:

- [x] No unbounded queue growth during network outage.
- [x] Background transition and manual `flush/shutdown` behavior are consistent.

### Task 7.3: RN networking docs (critical)

- [x] Add a dedicated RN setup section in `packages/sdk/README.md`:
  - [x] iOS simulator host usage
  - [x] Android emulator host mapping
  - [x] physical device on LAN
- [x] Include a concise troubleshooting table for common connection failures.
- [x] Include explicit collector host guidance (`127.0.0.1` vs `0.0.0.0` in dev).

Acceptance:

- [x] New RN user can connect to local collector without guesswork.

### Task 7.4: RN examples

- [x] Add small example snippets for:
  - [x] basic init + log calls
  - [x] context + `withFlow`
  - [x] background flush adapter wiring
  - [x] optional unhandled error capture
- [x] Keep examples minimal and framework-agnostic (RN + Expo-friendly notes).

Acceptance:

- [x] Examples are directly reusable in a fresh RN app with minimal edits.

### Task 7.5: Test coverage expansion

- [x] Add adapter tests for:
  - [x] custom `flushOnStates`
  - [x] repeated attach/detach
  - [x] memory warning callback behavior
  - [x] no-op behavior when optional RN hooks are missing
- [x] Keep existing SDK and integration tests green.

Acceptance:

- [x] `pnpm -C packages/sdk test` and `pnpm -r test` pass with added cases.

## Exit Artifacts

- Updated `packages/sdk/README.md` RN section.
- RN-focused example snippets/files in `packages/sdk`.
- Expanded adapter test coverage and documented behavior contracts.

## Stop Condition

Stop polishing once a new RN project can:

1. wire the SDK in under 10 minutes,
2. ingest to local collector reliably from simulator/device, and
3. observe expected flush behavior on background transitions.
