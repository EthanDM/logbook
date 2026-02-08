# @logbook/web

Local web dashboard for Logbook.

## Run

```sh
pnpm -C packages/web dev
```

Or from the CLI:

```sh
logbook web
```

Monorepo shortcut:

```sh
pnpm -C packages/cli dev -- web
```

Default dev URL: `http://127.0.0.1:5173`

Expected collector target: `http://127.0.0.1:8787`

## Demo Traffic

Run web + collector + synthetic traffic together from repo root:

```sh
pnpm demo:web
```

Run only the synthetic stream:

```sh
pnpm demo:stream
```

Replay deterministic fixture traffic:

```sh
pnpm demo:replay -- --fixture scripts/fixtures/web-demo.ndjson
```

You can also trigger synthetic burst generation directly from the dashboard
via the "Generate Burst" button in the Collector Health panel.

Override API target:

```sh
LOGBOOK_WEB_API_TARGET=http://127.0.0.1:8787 pnpm -C packages/web dev
```

## Current Routes

- `/` events table with filters, health panel, and summary snapshot
- `/event/:eventId` around-event context view
- `/flow/:flowId` ordered flow timeline

## Verify

```sh
pnpm -C packages/web test
pnpm -C packages/web build
```
