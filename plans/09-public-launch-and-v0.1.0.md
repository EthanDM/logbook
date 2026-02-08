# Public Launch and v0.1.0 Checklist

## Current State

- [x] CI green on `main`.
- [x] `SECURITY.md` present.
- [x] Issue templates present.
- [x] `LICENSE` (MIT) present.
- [x] Release workflow dry run created draft `v0.1.0-rc.1`.

## Public Launch Checklist

- [ ] Change repository visibility to Public.
- [ ] Confirm repository description is set and concise.
- [ ] Confirm homepage/repo topics (optional but recommended).
- [ ] Re-check README top section for clear local-dev scope.
- [ ] Verify no local machine paths or secrets in docs/examples.

## v0.1.0 Release Checklist

- [ ] Ensure local branch is synced with `origin/main`.
- [ ] Run full verification locally:
  - [ ] `pnpm install`
  - [ ] `pnpm -r build`
  - [ ] `pnpm -r typecheck`
  - [ ] `pnpm -r test`
- [ ] Run `Release` workflow with tag `v0.1.0`.
- [ ] Verify draft release:
  - [ ] correct tag `v0.1.0`
  - [ ] correct target commit on `main`
  - [ ] generated notes are accurate
- [ ] Publish the draft release.

## Post-Release Follow-ups

- [ ] Add a short "Quickstart" block near top of `README.md`.
- [ ] Decide whether to keep or delete `v0.1.0-rc.1` draft/tag.
- [ ] Track next milestone focus in `plans/`:
  - [ ] web UI MVP scope
  - [ ] SDK/RN documentation polish
  - [ ] CI/runtime hardening follow-ups
