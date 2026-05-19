---
name: self-review
description: Final check on your own changes before reporting a task done, opening a PR, or asking for review. Runs typecheck, affected tests, diff inspection, style audit, and `/code-review`, then returns a SHIP / ITERATE verdict. **MUST be invoked as a subagent** — a clean context yields an honest review; reviewing your own work inline produces blindspots. Triggers include "self review", "review my changes", "check my diff", "ready to commit", "ready for PR", "I'm done", "before I ship".
allowed-tools: Bash, Read, Glob, Grep
metadata:
  author: Mediforce
  version: "1.0"
  domain: development
  complexity: intermediate
  tags: review, quality, pre-pr
---

# Self-Review

## Hard rule — invoke as subagent

If you are the agent who wrote the code in this conversation, **STOP**. Spawn a subagent and have it run this skill. Reviewing your own work in the same context where you wrote it is unreliable — you carry "I just wrote this, it must be good" assumptions that an outside reader doesn't.

From the main thread:

```
Spawn subagent with prompt:
  Run /self-review on branch <current>. Report findings with verdict.
```

If you ARE the subagent invoked for this purpose, continue with the checks below. Treat the diff as if a stranger wrote it.

## Step 1 — Pre-flight

Run in parallel:

```bash
pnpm typecheck
pnpm test:affected
```

If either fails for a code reason — STOP, report the failure. No point reviewing code that doesn't compile or pass affected tests.

If a failure looks environmental (remote / emulator down / proxy / port collision / weird state), check `docs/knowledge-base/wiki/gotchas/` or invoke `/knowledge-base` before debugging from scratch — most repeat env failures are documented there. Distinguish "I broke this" from "the env is broken" before iterating.

## Step 2 — Read the diff

```bash
git diff origin/main...HEAD
```

Read every line. Not just the new files — also context lines around edits. Look for:

- Unjustified `any` (use Zod + `z.infer`).
- One-letter variable names.
- Implicit boolean comparisons (`if (foo)` vs `if (foo === true)`).
- Bash scripts (should be Python).
- New comments / docstrings added to code that was not changed.
- Hacks: `// TODO`, `// HACK`, `// FIXME`, commented-out blocks.
- Dead code: unused exports, never-called helpers, leftover scaffolding.
- Scope creep: unrelated refactors mixed in.
- Raw `fetch('/api/...')` in `"use client"` files — must use `mediforce.<domain>` or `apiFetch`.
- Missing CLI command for an operation that should be dogfooded — see `/use-mediforce`.

## Step 3 — Test coverage

Verify the diff has tests at the right level:

- New endpoint or handler → **L3 API E2E exists** (`packages/platform-ui/e2e/api/`). L2 alone is not enough.
- New pure logic → L1 unit exists co-located in `__tests__/`.
- New UI journey → L4 with GIF + gallery entry via `/e2e-test`.
- Trivial edit (typo, single-line config, comment-only) → no test needed; flag this explicitly.

If coverage is missing, that's a finding — not a "nice to have".

## Step 4 — Run `/code-review`

Delegate the architecture / security / convention pass to `/code-review`. It has its own 8-section checklist; don't duplicate.

## Step 5 — Verdict

Aggregate findings into one of two outputs:

### SHIP

```markdown
## Verdict: SHIP

- typecheck: pass
- test:affected: pass (N tests)
- test:unit (full): pass (N tests)
- test:e2e:api: pass (N tests)   ← if relevant to the diff
- diff: clean
- coverage: <level> in <path>
- code-review: no blockers

Ready to commit / open PR.
```

### ITERATE

```markdown
## Verdict: ITERATE

### Blockers
- `file:line` — what's wrong, what to do

### Should fix
- `file:line` — what's wrong, what to do

### Nice to have (optional)
- `file:line` — suggestion

Address blockers and re-run /self-review before shipping.
```

## What this skill does NOT do

- It does NOT commit, push, or open a PR. That's the main thread's job after acting on findings.
- It does NOT silently fix things. Findings come back as text — the main thread decides what to apply.
- It does NOT run the full `pnpm test:e2e` (browser, ~4min). That's a pre-merge gate — run it once before opening the PR. L3 `test:e2e:api` (~30s, no browser) IS part of Step 5 when the diff touches handlers / middleware.
