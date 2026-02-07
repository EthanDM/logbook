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

## Execution Order

1. Complete Milestone 0 and Milestone 1 first.
2. Finish Milestone 2 and verify Day 1 objective.
3. Implement Milestone 3 commands in this order: `dev`, `tail`, `find`, `summary`, `flow`, `around`.
4. Start SDK only after Day 1 objective demonstrates clear value.

## Status Convention

- `[ ]` Not started
- `[-]` In progress
- `[x]` Done

