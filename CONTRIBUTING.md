# Contributing

## Prerequisites

- Node.js `22.x` (matches CI)
- `pnpm@10.14.0`
- macOS, Linux, or Windows with local filesystem access

## Setup

```sh
pnpm install
```

## Workspace Commands

- Build all packages: `pnpm -r build`
- Typecheck all packages: `pnpm -r typecheck`
- Run all tests: `pnpm -r test`
- Run CI-equivalent checks locally:

```sh
pnpm -r build && pnpm -r typecheck && pnpm -r test
```

## Test Layers

- Unit tests:
  - `packages/core/test`
  - `packages/collector/test`
  - `packages/cli/test`
  - `packages/sdk/test`
- Integration tests:
  - `packages/integration/test/sdk-cli.e2e.test.ts`
  - Verifies SDK -> collector -> CLI behavior via workspace packages.
- Black-box tests:
  - `packages/integration/test/cli-smoke.e2e.test.ts`
  - Spawns the built CLI binary and validates real command flow.

## Running Tests By Package

- Core: `pnpm -C packages/core test`
- Collector: `pnpm -C packages/collector test`
- CLI: `pnpm -C packages/cli test`
- SDK: `pnpm -C packages/sdk test`
- Integration: `pnpm -C packages/integration test`

## CLI Golden Snapshots

`packages/cli/test/golden/summary.txt` and `packages/cli/test/golden/summary.md` are canonical output snapshots.

If CLI summary formatting changes intentionally:

1. Update `packages/cli/test/run-cli.test.ts` fixture data only if needed.
2. Regenerate expected output manually and update golden files.
3. Run `pnpm -C packages/cli test`.
4. Run full workspace checks before opening a PR.

Note: tests normalize volatile `last` time fragments to `<TIME>` to keep snapshots stable.

## Pull Request Checklist

1. Keep changes scoped to one concern when possible.
2. Run `pnpm -r build && pnpm -r typecheck && pnpm -r test`.
3. Update docs when behavior or configuration changes.
4. Include tests for behavior changes.
5. Keep CLI output deterministic (stable sort/order/sections).
