---
name: code-review
description: Review pull requests, branches, or your own pre-PR diff along three parallel axes — Standards (file-by-file conventions, dead code, DRY/KISS, comments), Spec (does it match the originating issue/PRD), and Big Picture (scope creep, removable features, duplicated mechanisms). Use when asked to review a PR, diff, branch, specific files, or your own changes before shipping.
allowed-tools: Bash, Read, Glob, Grep, Agent
metadata:
  version: "3.0"
  domain: development
  complexity: intermediate
  tags: review, quality, security, architecture, pre-pr
---

# Code Review

Three-axis review of a diff. Each axis runs as a **parallel sub-agent** so they don't pollute each other's context, then this skill aggregates findings side-by-side.

- **Standards** — file-by-file: conventions, dead code, DRY/KISS, reuse of existing repo mechanisms, comment quality.
- **Spec** — does the diff faithfully implement the originating issue / PRD?
- **Big Picture** — should any of this be removed? Does it duplicate something we already have? Scope creep?

## Usage

```
/code-review              # review current branch vs main
/code-review 42           # review GitHub PR #42
/code-review <ref>        # review HEAD vs arbitrary fixed point (SHA, branch, tag, main, HEAD~5)
/code-review --self       # pre-PR self-review of your own current diff (adds pre-flight + SHIP/ITERATE verdict)
```

## Self-review mode (`--self`)

Triggered explicitly with `--self`, or implicitly when invoked via `/self-review`.

**Hard rule — invoke as subagent if you wrote the code.** Reviewing your own work in the same context where you wrote it is unreliable — "I just wrote this, it must be good" assumptions carry over. The main thread MUST spawn a subagent and tell it to run this skill in self mode. The subagent treats the diff as if a stranger wrote it.

Self-review adds **Step 0 (pre-flight)** and **Step 6 (SHIP/ITERATE verdict)** around the normal three-axis flow. Skip Step 0 + Step 6 in other modes.

### Step 0 — Pre-flight (self-review only)

Run in parallel:

```bash
pnpm typecheck
pnpm test:affected
```

If either fails for a code reason — STOP, report. No point reviewing code that doesn't compile or pass affected tests.

If a failure looks environmental (remote/emulator down, port collision, weird state), check `docs/knowledge-base/wiki/gotchas/` or invoke `/knowledge-base` before debugging. Distinguish "I broke this" from "the env is broken" before iterating.

## Process

### 1. Pin the fixed point

- `/code-review` no arg → fixed point = `main` (or repo default). Diff: `git diff main...HEAD`.
- `/code-review <number>` → fixed point = PR base. Diff: `gh pr diff <number>`. Capture title/body via `gh pr view <number>`.
- `/code-review <ref>` → fixed point = ref. Diff: `git diff <ref>...HEAD` (three-dot, against merge-base).
- `/code-review --self` → same as no arg (current branch vs main).

Also capture commit list: `git log <fixed-point>..HEAD --oneline`.

### 2. Identify the spec source

Look in this order:
1. Issue refs in commit messages / PR body (`#123`, `Closes #45`) — fetch via `gh issue view <n>`.
2. PRD / spec file under `docs/`, `specs/`, `.scratch/` matching branch name or feature.
3. PR description itself (when reviewing a PR).
4. If nothing found, ask user. If they say there isn't one, **Spec** sub-agent skips and reports "no spec available".

### 3. Identify standards sources

Always include: `AGENTS.md`, `CLAUDE.md`, `docs/adr/`, `references/review-checklist.md`. Skip what tooling enforces (eslint, biome, tsconfig) — note their existence but don't re-check.

### 4. Spawn three sub-agents in parallel

Single message, three `Agent` tool calls, `general-purpose` subagent. Each prompt MUST include the diff command, commit list, and the relevant inputs from steps 2–3.

**Standards sub-agent prompt** (file-by-file, low-level):

> Read `AGENTS.md`, `CLAUDE.md`, and `.claude/skills/code-review/references/review-checklist.md`. Walk the diff **file by file, hunk by hunk**. For each changed file report:
> - Convention violations (cite the rule: file + line of the standard).
> - **Dead code** — functions/exports/files not referenced anywhere. Grep to verify.
> - **DRY/KISS violations** — duplicated logic, unnecessary abstraction, layers that solve nothing.
> - **Reuse misses** — places where the diff reinvents a helper/util/pattern that already exists in the repo. Search for it before flagging.
> - **Comment quality** — flag flowery / restating-the-code comments. Keep only comments that explain *why* (non-obvious constraints, invariants, gotchas). Self-documenting code wins.
> Distinguish hard violations from judgement calls. Skip anything tooling already checks. Under 600 words. Format each finding as `file:line — issue — suggestion`.

**Spec sub-agent prompt**:

> Read the spec (path/contents provided). Then read the diff. Report:
> - (a) Requirements asked for, missing or partial.
> - (b) Behaviour in the diff not asked for (scope creep — flag for the Big Picture axis too).
> - (c) Requirements that look implemented but wrong.
> Quote the spec line for each finding. Under 400 words.

**Big Picture sub-agent prompt**:

> You are reviewing for *should this exist at all*, not for code quality. Read the diff and the spec. Ask:
> - Are any added features/endpoints/UI elements **candidates for removal** instead of addition? Is the user replacing something — and if so, should the old thing be deleted in the same PR?
> - Does the diff **duplicate functionality** that already exists in the repo (search for similar handlers, helpers, components)? Could the new code be a thin wrapper instead?
> - Is there **scope creep** — work outside the stated intent that should be a separate PR?
> - Are we **reinventing platform mechanisms** (CLI vs raw fetch, our `apiFetch`, our Zod schemas, our workflow engine primitives) where the project already has the proper tool?
> Flag each item with a question for the user to confirm — these are big-picture judgement calls, not auto-rejections. Under 400 words.

If spec is missing: skip Spec, run Standards + Big Picture, note in final report.

### 5. Aggregate

Present three reports under `## Standards`, `## Spec`, `## Big Picture` headings, verbatim or lightly cleaned. Do **not** merge or rerank — axes are deliberately separate so one can't mask another.

End normal mode with:

```markdown
## Verdict
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION

## Summary
- Standards: N findings (worst: …)
- Spec: N findings (worst: …)
- Big Picture: N questions (worst: …)
```

### Step 6 — SHIP / ITERATE verdict (self-review only)

Replace the normal verdict with one of:

**SHIP** — only when ALL of:
- typecheck: pass
- test:affected: pass
- Standards: zero blockers, zero "should fix"
- Spec: nothing missing / wrong
- Big Picture: no open questions you couldn't answer with certainty
- Coverage exists at the right level: new endpoint → L3, new pure logic → L1, new UI journey → L4 with GIF
- No finding waved away as "pre-existing" without git-blame evidence (see next section)

```markdown
## Verdict: SHIP

- typecheck: pass
- test:affected: pass (N tests)
- diff: clean
- coverage: <level> in <path>
- Standards / Spec / Big Picture: no blockers

Ready to commit / open PR.
```

**ITERATE** — everything else:

```markdown
## Verdict: ITERATE

### Blockers
- `file:line` — what's wrong, what to do

### Should fix
- `file:line` — what's wrong, what to do

### Nice to have (optional)
- `file:line` — suggestion

Address blockers and re-run before shipping.
```

## The "pre-existing" excuse — treat as smell

When a sub-agent (or the implementer) labels a finding "pre-existing, not introduced by this PR" — **do not auto-accept**. This is one of the most common cop-outs and often disguises:

- Code the diff *touched* (same function, same file) but didn't fix while it was there.
- Bugs the diff *exposed* or *propagated* further.
- Issues the implementer noticed and chose to skip.

**Hard verification before accepting a "pre-existing" claim:**

1. `git blame <file> -L <line>,<line>` — was this line authored before the branch diverged? If the line itself is from the diff, it's not pre-existing, full stop.
2. Even if the line is older: does the diff touch the same function / module / call path? If yes, the diff inherits responsibility — "while you're here, fix it" applies.
3. Is the "pre-existing" issue something that would have been caught by the new standards / new test the diff adds? Then the diff should fix it consistently.
4. Did the implementer *know* about it (commit messages, comments, conversation)? Knowing-and-skipping is a different category from didn't-notice.

**Legitimate pre-existing**: line authored months ago, in a file the diff doesn't touch, surfaced only by an unrelated grep, with a real reason it can't be in scope (separate domain, risky refactor, would balloon the PR). Document why and ship — but **only after the above verification**, never on the implementer's word alone.

Reject "pre-existing" claims phrased as: "this was already broken", "not my change", "unrelated", "out of scope" — without git evidence.

In `--self` mode this is a hard gate: any finding waved away as pre-existing without `git blame` output forces ITERATE.

## Why three axes

A change can pass one and fail another:
- Follows every standard but implements wrong thing → Standards pass, Spec fail.
- Does exactly what issue asked but breaks conventions → Spec pass, Standards fail.
- Both correct and well-written but **shouldn't exist** (duplicates existing feature, scope creep) → Standards + Spec pass, Big Picture fail.

Reporting separately stops one axis from masking another.

## Rules

- MUST check every changed file against the checklist.
- MUST flag known project conventions from `AGENTS.md` (no `any`, explicit booleans, Python scripts, CLI > REST, etc.).
- MUST NOT rubber-stamp — flag real issues, not just style preferences.
- MUST include `file:line` references for every Standards / Spec finding.
- Big Picture findings phrased as **questions to the user**, not assertions.
- MUST verify every "pre-existing" claim with `git blame` before accepting it.
- In `--self` mode: SHIP only when actually fixed; ITERATE if anything was waved away as pre-existing without git evidence.
- If no findings in a category, omit that subsection.

## What this skill does NOT do

- Does NOT commit, push, or open a PR — main thread acts on findings.
- Does NOT silently fix things — findings come back as text, main thread decides.
- Does NOT run full `pnpm test:e2e` (browser, ~4min) — pre-merge gate, run once before opening PR. L3 `test:e2e:api` (~30s, no browser) IS in scope when the diff touches handlers/middleware in `--self` mode.
