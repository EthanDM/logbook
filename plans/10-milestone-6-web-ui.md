# Milestone 6 — Web UI (Local Dev Dashboard)

## Goal

Build a local, read-only web dashboard for Logbook that makes event inspection faster than CLI for exploratory debugging, while preserving the current local-first, dev-only model.

## Scope (MVP)

- Read-only UI (no event mutation).
- Works against local collector + SQLite.
- Event list with live refresh, filters, and detail view.
- Flow timeline and around-event context view.
- Basic health/status panel.

## Out of Scope (MVP)

- Auth, users, roles, remote access hardening.
- Multi-project tenancy.
- Production hosting/deployment model.
- Alerting/metrics dashboards.

## Recommended Stack

- Frontend: React + TypeScript + Vite.
- Data/state: TanStack Query.
- Routing: React Router (or TanStack Router if preferred).
- UI primitives: minimal custom CSS first; optional component library later.

Why this stack:

- Fast local startup, low ceremony.
- Strong ecosystem for tables/filters/state.
- No SSR requirement, so Next.js is unnecessary complexity for MVP.

## Task Breakdown

### Task 6.1: Add `packages/web` scaffold

- Create `packages/web` with Vite + React + TS.
- Add scripts: `dev`, `build`, `typecheck`, `test` (optional initial smoke).
- Add basic app shell and environment config for collector base URL.

Acceptance:

- [ ] `pnpm -C packages/web dev` starts locally.
- [x] `pnpm -C packages/web build` succeeds.

### Task 6.2: Add collector read endpoints

Add API routes in collector for web/CLI parity:

- `GET /events` with filters + pagination:
  - `since`, `until`, `level`, `name`, `deviceId`, `sessionId`, `flowId`, `limit`, `offset`
- `GET /events/:eventId/around?windowMs=...`
- `GET /flows/:flowId`
- `GET /summary?since=...&until=...`

Notes:

- Reuse existing DB query logic where possible.
- Keep output deterministic and typed.

Acceptance:

- [x] Endpoints return valid JSON with expected filters/order.
- [x] Existing collector tests continue passing; new route tests added.

### Task 6.3: Local CORS/dev integration

- Allow CORS for localhost dev origins (configurable).
- Add env/config docs for web <-> collector integration.

Acceptance:

- [x] Browser requests succeed in local dev via Vite `/api` proxy.

### Task 6.4: Events table view

- Render recent events with polling (e.g. every 1s).
- Columns: ts, level, name, device, session, flow, message/payload summary.
- Filters panel matching `/events` query params.

Acceptance:

- [x] Can filter by level/name/device/flow and see deterministic results.

### Task 6.5: Event detail + around context

- Click row to open detail panel/page.
- Show full payload JSON and metadata.
- Show +/- time-window context via `/events/:id/around`.

Acceptance:

- [x] Detail and context are consistent with CLI `around`.

### Task 6.6: Flow timeline view

- Show ordered events for a selected `flowId`.
- Include per-event timestamp and optional delta timing.

Acceptance:

- [x] Flow view reads as a coherent sequence and matches CLI `flow`.

### Task 6.7: Health/status panel

- Display `/health` data:
  - queue length
  - dropped events
  - flush/retention failures
  - DB path

Acceptance:

- [x] Panel updates and reflects collector state changes.

### Task 6.8: CLI integration ergonomics

- Add a command such as `logbook web`:
  - Starts collector if needed.
  - Starts web dev server (or prints instructions).
- Document single-command local workflow.

Acceptance:

- [x] One clear command path to run collector + UI locally.

## Quality Gates

- [x] `pnpm -r build` passes.
- [x] `pnpm -r typecheck` passes.
- [x] `pnpm -r test` passes.
- [x] README updated with Web UI usage.

## Definition of Done

- [x] Collector read APIs power the web dashboard (`/events`, `/events/:id/around`, `/flows/:flowId`, `/summary`).
- [x] Web package compiles and typechecks in workspace.
- [x] Web unit tests run in CI/local (`pnpm -C packages/web test`).
- [x] One-command local path exists via `logbook web`.
- [ ] Manual local smoke run completed on host machine:
  - [ ] `logbook web` starts collector and UI
  - [ ] filters + pagination work in browser
  - [ ] detail/around and flow pages load expected data

## Stop Condition

Stop expanding UI once this loop works reliably:

1. Start collector.
2. Ingest sample events.
3. Open web UI and find those events quickly with filters.
4. Inspect one event detail, around-context, and flow timeline.

Only after this should advanced features (saved views, richer charts, auth model) be considered.
