---
name: code-review
description: Review pull requests and code changes along three parallel axes — Standards (file-by-file conventions, dead code, DRY/KISS, comments), Spec (does it match the originating issue/PRD), and Big Picture (scope creep, removable features, duplicated mechanisms). Use when asked to review a PR, diff, branch, or specific files.
allowed-tools: Bash, Read, Glob, Grep, Agent
metadata:
  version: "2.0"
  domain: development
  complexity: intermediate
  tags: review, quality, security, architecture
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
```

## Process

### 1. Pin the fixed point

- `/code-review` with no arg → fixed point = `main` (or repo default branch). Diff: `git diff main...HEAD`.
- `/code-review <number>` → fixed point = PR base. Diff: `gh pr diff <number>`. Capture title/body via `gh pr view <number>`.
- `/code-review <ref>` → fixed point = ref. Diff: `git diff <ref>...HEAD` (three-dot, against merge-base).

Also capture commit list: `git log <fixed-point>..HEAD --oneline`.

### 2. Identify the spec source

Look in this order:
1. Issue refs in commit messages / PR body (`#123`, `Closes #45`) — fetch via `gh issue view <n>`.
2. PRD / spec file under `docs/`, `specs/`, `.scratch/` matching branch name or feature.
3. PR description itself (when reviewing a PR).
4. If nothing found, ask user. If they say there isn't one, **Spec** sub-agent skips and reports "no spec available".

### 3. Identify standards sources

Always include: `AGENTS.md`, `CLAUDE.md`, `docs/adr/` (architectural decisions are standards), `references/review-checklist.md` (this skill's checklist). Skip what tooling enforces (eslint, biome, tsconfig) — note their existence but don't re-check.

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

End with:

```markdown
## Verdict
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION

## Summary
- Standards: N findings (worst: …)
- Spec: N findings (worst: …)
- Big Picture: N questions (worst: …)
```

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
- If no findings in a category, omit that subsection.
