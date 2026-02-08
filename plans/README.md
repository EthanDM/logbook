# Logbook Implementation Plans

This folder contains execution-ready planning docs for building Logbook with:

- Node.js + TypeScript
- Fastify HTTP collector
- SQLite via `better-sqlite3`
- `pnpm` workspaces
- CLI via `commander` or `cac`

## Plan Index

1. `plans/00-decisions.md`
2. `plans/01-milestone-0-repo-scaffolding.md`
3. `plans/02-milestone-1-db-and-schema.md`
4. `plans/03-milestone-2-collector-ingest.md`
5. `plans/04-milestone-3-cli-core.md`
6. `plans/05-milestone-4-sdk.md`
7. `plans/06-milestone-5-prod-sink-later.md`
8. `plans/07-cross-cutting.md`
9. `plans/08-day-1-objective.md`
10. `plans/09-public-launch-and-v0.1.0.md`
11. `plans/10-milestone-6-web-ui.md`
12. `plans/11-milestone-7-sdk-polish-rn.md`
13. `plans/12-milestone-8-hardening.md`

## Execution Order

1. Complete Milestone 0 and Milestone 1 first.
2. Finish Milestone 2 and verify Day 1 objective.
3. Implement Milestone 3 commands in this order: `dev`, `tail`, `find`, `summary`, `flow`, `around`.
4. Start SDK only after Day 1 objective demonstrates clear value.
5. After Web UI MVP, run Milestone 7 for RN SDK polish and onboarding docs.
6. Run Milestone 8 hardening before broad external usage and contribution ramp-up.

## Status Convention

- `[ ]` Not started
- `[-]` In progress
- `[x]` Done
