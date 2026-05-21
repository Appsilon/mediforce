# Changelog

All notable changes to Mediforce.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Weekly cuts via [`/add-changelog-entry`](skills/add-changelog-entry/SKILL.md) + auto-cut every Monday 09:00 CET ([`.github/workflows/changelog-cut.yml`](.github/workflows/changelog-cut.yml)).

Every non-trivial PR adds a bullet under `## [Unreleased]`. Trivial edits (typos, single-line config, comment-only diffs) may be omitted. Renovate bumps batch under `### Dependencies`.

---

## [Unreleased]

### Removed
- Duplicate Python migration script `scripts/migrations/migrate_workflow_doc_ids.py` — superseded by the TypeScript `packages/platform-infra/scripts/migrate-workflow-namespacing.ts` which is the canonical version ([#424](https://github.com/Appsilon/mediforce/pull/424)).

### Fixed
- `pnpm dev:mock` now starts local Firebase emulators, seeds demo data, and then boots Next, so the browser no longer falls into offline Firestore/Auth mode on a fresh mock-dev run.
- Workspace `Runs` page no longer leaks runs from other namespaces the viewer is a member of — list is now filtered to the current `handle`, and `useProcessInstances` requires `namespace` so TypeScript catches future regressions compile-time ([#424](https://github.com/Appsilon/mediforce/pull/424), follow-ups tracked in [#447](https://github.com/Appsilon/mediforce/issues/447) and [#448](https://github.com/Appsilon/mediforce/issues/448)).
- Instance namespace backfill now resolves namespace per instance definition version instead of global latest-by-name, preventing cross-tenant run reassignment during migration ([#424](https://github.com/Appsilon/mediforce/pull/424)).
- Workflow definition storage now scopes definition and metadata keys by namespace, so tenants can register the same workflow name independently ([#424](https://github.com/Appsilon/mediforce/pull/424)).
  - Migration script splits the legacy global `workflowMeta/<name>` into one doc per owning namespace and strips `defaultVersion` for tenants that don't own that version, avoiding dangling defaults pointing at non-existent workflow definitions ([#424](https://github.com/Appsilon/mediforce/pull/424)).

## [2026-05-17]

### Added
- Phase 1 of the headless-API migration is done — 10 GET endpoints across tasks, processes, definitions, cowork and plugins now sit behind framework-free handlers in `@mediforce/platform-api`, with namespace policy enforced inside the handler (every handler signature requires a `CallerIdentity`, so a missing gate is a code-level decision in review, not a silent regression). Wraps `audit` response as `{ events }` and surfaces visibility-denied agent definitions as 404 (anti-enumeration). Supersedes [#256](https://github.com/Appsilon/mediforce/pull/256), which predated the namespace access control on `main` and would have regressed it.
- Workflows can now be moved between namespaces — copy + redirect lands you in the target tenant ([#359](https://github.com/Appsilon/mediforce/pull/359), [#370](https://github.com/Appsilon/mediforce/pull/370)).
- Workflow discovery by Docker image: `GET /api/workflows/by-image` — needed to scale step containers without grepping definitions ([#377](https://github.com/Appsilon/mediforce/pull/377)).
- Human review steps are no longer binary — each step declares its own verdicts and target transitions (e.g. approve / request changes / escalate), wired end-to-end from schema to UI ([#396](https://github.com/Appsilon/mediforce/pull/396)).
- SDTM rule migration workflow — Vedha's legacy rule definitions ported to CDISC SDTM via a dedicated Mediforce app ([#355](https://github.com/Appsilon/mediforce/pull/355)).
- Validation reports are now reproducible — landing-zone data-validator renders from a study-owned template instead of regenerating HTML each run, with an injection-demo variant for the propose-rules story ([#402](https://github.com/Appsilon/mediforce/pull/402), [#408](https://github.com/Appsilon/mediforce/pull/408)).
- Two ways to seed the Landing Zone demo on the same Hetzner SFTP host — `demo-console/` (FastAPI SPA, operator-facing) and `demo-uploader/` (Mediforce workflow with 8-verdict human review) ([#407](https://github.com/Appsilon/mediforce/pull/407)).

### Changed
- Cowork is now per-workspace billed — the OpenRouter key is read from workspace secrets instead of a global env var; chat textarea auto-grows to fit input ([#378](https://github.com/Appsilon/mediforce/pull/378), [#381](https://github.com/Appsilon/mediforce/pull/381), [#382](https://github.com/Appsilon/mediforce/pull/382)).
- Dev setup is no longer a footgun — `pnpm dev:mock` boots the app with mocks in one command, every script is named for what it does (`dev:test` → `dev:mock`, `dev:local` → `dev:no-docker`, `dev:ui:queue` → `dev:queue`), `pnpm test` runs the full pyramid instead of vitest only, and `bootstrap-dev.py` with its silent `OPENROUTER_API_KEY=fake-…` trap is gone in favour of a commented `.env.example` [#421](https://github.com/Appsilon/mediforce/pull/421).
- Agent output is now consistent across surfaces — step detail and human-task panel share one `AgentOutputDisplay`, so L2 auto-runner steps (e.g. `interpret-validation`) finally show their HTML report without needing an L3 review ([#409](https://github.com/Appsilon/mediforce/pull/409)).
- Tests now have a 5-level pyramid with API E2E as the explicit foundation — `e2e/api/` is a dedicated Playwright project running real Next + emulators over HTTP (no browser), separated from `e2e/ui/` (sparse multi-step user journeys only, not "is button visible"). Misleading legacy names cleaned up: `src/test/*.test.ts` → `src/test/integration/`, `e2e/api/` (tier-2 real-LLM) → `e2e/external/`, `e2e/journeys/` → `e2e/ui/` ([#413](https://github.com/Appsilon/mediforce/pull/413)).

### Fixed
- Agent report iframe no longer blows up its host panel — height is capped and `vh` classes inside the report are neutralised ([#392](https://github.com/Appsilon/mediforce/pull/392)).
- Mock dev workflows now run seeded agent steps through the mock Claude runtime even when their demo plugin ids are not registered, the model ranking sync helper falls back from `9003` to `9007` for `pnpm dev:mock`, root API/UI E2E wrappers pass Playwright project flags correctly, and `mediforce run start` can target a namespace.
- Staging step containers can finally see workspace files — the data dir is persisted at `/var/lib/mediforce` with an identical host bind so docker.sock-spawned containers share the same path ([#405](https://github.com/Appsilon/mediforce/pull/405)).
- CLI network failures now explain the unreachable API host, reason, and recovery hints instead of printing raw `TypeError: fetch failed` ([#397](https://github.com/Appsilon/mediforce/issues/397)).
  - Follow-up: local I/O failures (for example `EACCES`) are no longer mislabeled as API network errors and now keep their original actionable message ([#397](https://github.com/Appsilon/mediforce/issues/397)).
  - Follow-up: dual-stack fetch failures now classify `AggregateError.errors[]` causes, and staging/remote URLs no longer suggest starting a local dev server ([#397](https://github.com/Appsilon/mediforce/issues/397)).

### Dependencies
- tailwindcss v4.2.4 ([#374](https://github.com/Appsilon/mediforce/pull/374)), yaml v2.8.4 ([#371](https://github.com/Appsilon/mediforce/pull/371)), pnpm v10.33.2 ([#372](https://github.com/Appsilon/mediforce/pull/372)), fast-xml-parser v5.7.2 ([#375](https://github.com/Appsilon/mediforce/pull/375)), jsdom v29.1.1 ([#379](https://github.com/Appsilon/mediforce/pull/379)), lucide-react v1.14.0 ([#380](https://github.com/Appsilon/mediforce/pull/380)).

## [2026-05-10]

### Added
- Workflows now have per-namespace visibility and access control — no more leaking definitions across tenants ([#346](https://github.com/Appsilon/mediforce/pull/346)).
- Agents have public/private visibility — fixes the gap where staging couldn't see agents owned by other namespaces ([#353](https://github.com/Appsilon/mediforce/pull/353)).
- Per-step cost in dollars now surfaces in run + step lists, so you can see which step burned the budget ([#348](https://github.com/Appsilon/mediforce/pull/348)).
- Per-namespace OpenRouter credit tracking + `mediforce credits` CLI — each tenant sees its own balance ([#349](https://github.com/Appsilon/mediforce/pull/349)).
- Mediforce reviews its own PRs — `pr-reviewer-mediforce` workflow runs AGENTS.md-aware review on every PR ([#338](https://github.com/Appsilon/mediforce/pull/338)).

### Changed
- Public profile pages are safe for unauth viewers — member-only UI and secrets are hidden, avatar falls back to the linked user photo ([#350](https://github.com/Appsilon/mediforce/pull/350), [#354](https://github.com/Appsilon/mediforce/pull/354)).
- Public pages no longer need a Firestore client — they call the REST API directly, which unblocks SSR and avoids leaking client config ([#358](https://github.com/Appsilon/mediforce/pull/358)).
- AGENTS.md tightened around dogfooding, RED→GREEN, and self code review — fewer ways for agents to skip the safeguards ([#352](https://github.com/Appsilon/mediforce/pull/352), [#356](https://github.com/Appsilon/mediforce/pull/356)).
