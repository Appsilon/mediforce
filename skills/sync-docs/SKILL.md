---
name: sync-docs
description: Check whether the current session's code changes made any documentation untrue, and fix what did. Routes each change to the doc that owns it — colocated package/app READMEs first, then the docs/ routing table. Use before reporting a task done, opening a PR, or committing; also on demand for a commit, a PR, or a full audit. Triggers include "sync docs", "update docs", "check docs", "are docs up to date", "docs stale", "documentation outdated", "did I break any docs".
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
metadata:
  author: Mediforce
  version: "2.0"
  domain: development
  complexity: moderate
  tags: documentation, maintenance, sync
---

# sync-docs

Answer one question: **what did this change make untrue?** Then fix it, in this
diff.

This is the edit-drift lever ADR-0017 names. Colocation solves deletion-drift
structurally — `git rm -r packages/foo` takes its README along. It does nothing
for a README that still describes a renamed export. That is this skill's job.

## Default mode — the session check

`/sync-docs` with no arguments checks **what you changed in this session**. This
is the mode `AGENTS.md` rule 11 invokes and the one that matters; the rest are
on demand.

```bash
git status --porcelain          # includes untracked — a NEW package is untracked
git diff HEAD                   # staged + unstaged against HEAD
```

Use both. `git diff HEAD` alone misses a newly added directory entirely, which
is precisely the "new package has no README" case.

Clean worktree → fall back to `git diff HEAD~1 HEAD` and say you did.

## Step 1 — route each change to the doc that owns it

Two mechanisms. Try colocated first; it needs no list.

### Colocated — derived from the path

A change under `packages/foo/` or `apps/foo/` routes to `packages/foo/README.md`
/ `apps/foo/README.md`. No lookup table: the path **is** the routing.

Open that README whenever the change touches what the package is *for*, what
depends on it, or any symbol, directory, filename or command it names.

### Cross-cutting — the routing table

For anything spanning more than one package, `docs/README.md`'s routing table is
the one list. Read it at the start of every run; never keep a copy here. Act on
`status: living` only — `draft` is undecided, `historical` is a record of a past
state and correctly describes a repo that no longer exists.

### Change → doc

| Changed | Update |
|---|---|
| New `packages/*/` or `apps/*/` | its `README.md` (CI gate: `pnpm check:readmes`) |
| Renamed / deleted export, class, dir, `.wd.json`, script | **every** doc naming it — see the grep below |
| Export added to `src/index.ts` | usually **nothing** — see "what not to write" |
| CLI command added / renamed / flag changed | `packages/cli/README.md`, `docs/start/dev-quickref.md` |
| Env var added / renamed | README of the package reading it, `docs/start/dev-quickref.md`, and `docker-compose.prod.yml` (`AGENTS.md` rule 13 — an unforwarded var silently never arrives) |
| Port changed | `docs/start/dev-quickref.md`, `packages/platform-ui/README.md` |
| Step executor / action kind / step type | `docs/reference/workflow-capabilities.md`, `packages/core-actions/README.md` |
| Handler / contract / adapter **pattern** | `docs/reference/api-architecture.md` |
| Domain schema in `platform-core` | `packages/platform-core/README.md` |
| Container spawn / image / git-mode behaviour | `docs/reference/container-steps.md`, `packages/agent-runtime/src/plugins/README.md` |
| Test level or harness | `docs/testing/` |
| An architectural decision | a **new ADR** — never retro-edit an existing one |

A rename is the highest-yield case and is mechanical:

```bash
grep -rln 'OldSymbolName' --include='*.md' packages/ apps/ docs/ skills/ AGENTS.md
```

Every hit is a doc that now lies. This is the check that catches
`TriggerHandler`, `MockClaudeCodeAgentPlugin`, `src/graph/` — the class that
killed the wiki.

## Step 2 — fix directly, or propose

Decided by **what the claim is**, not by which file holds it.

**Fix directly** when the fact is mechanically verifiable and has one right
answer: port, script name, env var, path, filename, symbol name, command flag,
version constraint. Verify against source before editing — `package.json`
scripts, `.env.example`, `packages/cli/src/commands/`, `.nvmrc`, the actual
directory listing. Report the line changed.

**Propose** when the claim is a sentence about behaviour, rationale, or a model.
Edit surgically, then print `git diff <file>` and one line naming the trigger.
Never rewrite sections the change did not touch.

Two things are never targets: `CHANGELOG.md` is a signal source, and an ADR
records a decision as of a date — if the code diverged, that is a new ADR, not
an edit.

## Step 3 — what to write in a package README

A README answers what the code cannot say: **what the package is for, what
depends on it, what you must not do to it.**

**What not to write.** Do not restate `src/index.ts`. A new export earns a
README line only when it changes the package's purpose or adds a rule a caller
must follow. A README that enumerates its own exports rots on the next rename
and buys nothing a reader could not get from the file — that is the mistake
ADR-0017 retired a whole system over.

Naming a symbol buys precision and takes on a maintenance obligation. Name one
only when a reader needs it to navigate. Prefer the rule ("plugins are
autonomy-agnostic") over the inventory ("exports `AgentRunner`,
`PluginRegistry`, …").

If an edit pushes a README past ~60 lines, cut something. Deep mechanics belong
in `docs/reference/` with a link.

For `docs/reference/`: exact and code-cited; fix values in place. For
`docs/concepts/`: the model and the why — edit only when the *model* changed,
not when an implementation detail moved beneath it.

## Step 4 — report

```
sync-docs — session diff (7 files changed)

  fixed     packages/cli/README.md — 60 → 62 commands
  fixed     docs/start/dev-quickref.md:44 — port 9003 → 9004
  proposed  packages/agent-runtime/README.md — TriggerHandler renamed to
            WebhookRouter (review `git diff` before staging)
  ok        packages/platform-core/README.md, docs/reference/api-architecture.md

  no doc owns: packages/platform-api/src/handlers/runs/cancel.ts
               (new handler, pattern unchanged — nothing to update)
```

State the "no doc owns" line explicitly. Silence reads as "not checked"; a
reader cannot tell the difference between a clean pass and a skipped one.

## Other modes

```
/sync-docs --commit <sha>    git diff <sha>~1 <sha>
/sync-docs --pr <number>     gh pr diff <number>
/sync-docs --audit           CHANGELOG [Unreleased] bullets as the signal
```

`--audit` walks the routing table plus every `packages/*/README.md` and
`apps/*/README.md`. It is the slow sweep — do not run it as the session check.
