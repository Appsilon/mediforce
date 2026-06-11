---
name: sync-docs
description: Keep project documentation in sync with code changes. Detects stale docs in current worktree diff (default), a specific commit, a PR, or across all monitored files (--audit). Auto-fixes Tier 1 executable docs (commands, ports, env vars); proposes Tier 2 narrative doc updates as an editable git diff. Triggers: "sync docs", "update docs", "check docs", "are docs up to date", "docs stale", "documentation outdated".
allowed-tools: Bash, Read, Edit, Write
metadata:
  author: Mediforce
  version: "1.0"
  domain: development
  complexity: moderate
  tags: documentation, maintenance, sync
---

# sync-docs

Keep the project's documentation in sync with code changes.

## Monitored docs

**Edit these lists to add new files as the project grows.**

### Tier 1 — executable truth (auto-apply)

Commands, ports, env vars, script names, CLI flags. The correct value is verifiable from code — fixes are applied directly and reported.

- `GETTING-STARTED.md`
- `docs/dev-quickref.md`
- `docs/postgres-local-dev.md`
- `docs/running-workspace-locally.md`
- `docs/CONTAINER_STEPS.md`

### Tier 2 — narrative truth (propose)

Feature descriptions, architecture overviews, concept explanations. Changes are written as a draft and shown as a `git diff` for review before staging.

- `README.md`
- `docs/architecture.md`
- `docs/api-architecture.md`

## Usage

```
/sync-docs                        # diff mode (default) — worktree changes vs HEAD
/sync-docs --commit <sha>         # specific commit
/sync-docs --pr <number>          # GitHub PR diff
/sync-docs --audit                # full audit — uses CHANGELOG [Unreleased] as signal
```

## Procedure

### Step 1 — Resolve the change signal

**diff mode (default — no args):**
```bash
git diff HEAD
```
If the result is empty (clean worktree), fall back to the last commit:
```bash
git diff HEAD~1 HEAD
```

**`--commit <sha>`:**
```bash
git diff <sha>~1 <sha>
```

**`--pr <number>`:**
```bash
gh pr diff <number>
```

**`--audit`:**
Read `CHANGELOG.md` and extract all bullet entries under `## [Unreleased]`. These curated summaries are the change signal — no git diff needed. If `[Unreleased]` is empty, also extract the most recent dated section.

---

### Step 2 — Tier 1: detect and fix executable staleness

For each Tier 1 file, in parallel:

1. Read the full file.
2. Extract every: `pnpm`/`npm` script name, port number, env var name (e.g. `MEDIFORCE_API_KEY`), CLI command (`mediforce <cmd>`), Docker Compose service name, prerequisite version constraint.
3. Verify each against the current codebase:
   - **Script names** → `package.json` `scripts` field at repo root and relevant package
   - **Ports** → grep `packages/` and `apps/` for the port constant or literal
   - **Env vars** → `.env.example`, `packages/platform-infra/src/`, `packages/platform-ui/src/`
   - **CLI commands** → `packages/cli/src/`
   - **Prerequisite versions** → `.nvmrc`, `package.json` `engines` field, `pnpm-workspace.yaml`
4. For each mismatch: update the doc in place with the correct value.
5. Report: `✓ GETTING-STARTED.md` (no changes) or `fixed GETTING-STARTED.md: renamed dev:mock → dev:local (line 31)`.

---

### Step 3 — Tier 2: semantic staleness analysis

For each Tier 2 file, in parallel:

1. Read the full doc.
2. Using the change signal from Step 1, analyse: does any claim, description, named pattern, or example in the doc conflict with or become incomplete given what changed? Focus on:
   - Named features, autonomy levels, or patterns that were renamed, removed, or redesigned
   - Package names, directory names, or import paths that no longer exist
   - Workflow or API behaviour now described incorrectly
   - Architectural patterns superseded by a newer ADR (e.g. Server Actions removed by ADR-0005)
3. If no issues found: report `✓ <file>` and move on.
4. If issues found:
   - Edit the file surgically — update only what the change signal makes inaccurate. Do not rewrite correct sections.
   - After editing, run `git diff <file>` and print the full diff.
   - State one sentence explaining the trigger (e.g. "ADR-0005 removed Server Actions — architecture.md still described the old pattern").

---

### Step 4 — Summary report

After all files are processed:

```
sync-docs complete
  auto-fixed : GETTING-STARTED.md (line 31: dev:mock → dev:local)
  proposed   : docs/architecture.md — review with git diff before staging
  up to date : README.md, docs/dev-quickref.md, docs/api-architecture.md, ...
```

Remind the user to inspect Tier 2 changes with `git diff` before staging.

---

## Exclusions

Never modify:
- `CONTEXT.md` — owned by `/grill-with-docs` (domain glossary)
- `AGENTS.md`, `CLAUDE.md` — engineering process policy, human-authored only
- `docs/vision.md`, `docs/how-we-work.md`, `docs/ai-development-process.md` — strategy/policy
- `docs/headless-migration*.md`, `docs/PREVIOUS_RUN.md` — ephemeral plans
- `CHANGELOG.md` — change signal source only, never a target
- `docs/E2E-STRATEGY.md`, `docs/ENGINE-TESTING.md` — testing process, not product docs
- `docs/adr/` — ADRs are immutable records of past decisions
