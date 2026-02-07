# Milestone 0: Repo Scaffolding

## Goal

Set up a workspace layout that supports collector, CLI, shared core types, and future SDK.

## Tasks

- [x] Create `pnpm-workspace.yaml` with `packages/*`.
- [x] Update root `package.json` with workspace scripts: `build`, `dev`, `test`, `typecheck`, `lint` (placeholders are fine initially).
- [x] Add `.gitignore`.
- [x] Add `.editorconfig`.
- [x] Keep root `README.md` as product spec.
- [x] Create package folders: `packages/core`, `packages/collector`, `packages/cli`, `packages/sdk` (can stay empty until Milestone 4).

## Acceptance Criteria

- [x] `pnpm -r build` runs without failing.
- [x] Workspace is installable via `pnpm install`.
- [x] Package boundaries are clear and imports compile.

## Exit Artifacts

- Root workspace files committed.
- Initial package manifests committed.

## Notes

- Build and typecheck scripts are intentionally stubs in Milestone 0.
- Real TypeScript compile and package wiring happen in Milestones 1-3.
