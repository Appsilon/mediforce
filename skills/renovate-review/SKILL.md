---
name: renovate-review
description: Review and validate Renovate dependency PRs. Assesses risk, runs tests, fixes simple issues, and recommends merge/close/hold. Use when reviewing PRs from Renovate bot.
allowed-tools: Bash, Read, Glob, Grep, WebFetch
metadata:
  author: Appsilon
  version: "1.0"
  domain: devops
  complexity: basic
  tags: renovate, dependencies, review, ci
---

# Renovate PR Review

## Usage

```
/renovate-review          # review all open Renovate PRs
/renovate-review 77       # review a specific PR
```

## Task

### Batch mode (no argument)

List all open Renovate PRs and triage them:

```bash
gh pr list --author "renovate[bot]" --state open --json number,title,statusCheckRollup
```

Group PRs by ecosystem before processing:

| Ecosystem | Packages | Why group |
|-----------|----------|-----------|
| **React** | react, react-dom, @types/react, next | Must be compatible; test together |
| **Radix UI** | @radix-ui/* | Shared versioning, test together |
| **Firebase** | firebase, firebase-tools, firebase-admin | Shared auth/SDK, test together |
| **Testing** | vitest, @playwright/test, @testing-library/* | Test infra, validate independently |
| **Build** | typescript, tailwindcss, postcss, autoprefixer | Build chain, may interact |

PRs in the same ecosystem should be checked out together (stack branches or merge locally) and tested as a group — if one breaks, the others may fix it or depend on it.

Process order: Low risk first (quick wins), then Medium, then High. For each PR (or ecosystem group), follow the single-PR workflow below.

Present a summary table at the end:

```
| PR | Package | Risk | Verdict |
|----|---------|------|---------|
| #77 | recharts 3.7→3.8 | Low | MERGE |
| #65 | typescript 5→6 | High | HOLD — breaking changes, see migration notes |
```

### Single PR mode

Given a Renovate PR number, review it end-to-end:

### 1. Fetch PR details

```bash
gh pr view {{NUMBER}} --json title,body,changedFiles,statusCheckRollup
```

Note the title (package + version), changed files, and CI status.

### 2. Assess change risk

| Risk | Examples |
|------|----------|
| **Low** | devDependencies, Docker tags, tooling (eslint, prettier), lockfile-only |
| **Medium** | CSS framework (tailwindcss), runtime utils (date-fns, clsx), test libs |
| **High** | Framework (next, react), core lib (zod, firebase), language (typescript) |

**Major version bumps** (e.g., 5→6, 18→19) are always at least Medium, even for low-risk packages. For High-risk major bumps:

1. Check the package's changelog or release notes for breaking changes:
   ```bash
   gh api "repos/{owner}/{repo}/releases/latest" --jq '.body' 2>/dev/null
   ```
   Or fetch the changelog/migration guide from the package's docs (use WebFetch if needed).
2. List breaking changes that affect this codebase — grep for deprecated APIs, removed features, changed defaults.
3. Include a **Migration notes** section in the report with what needs attention.

### 3. Check CI status

If all checks already passed on the PR branch, note it — this significantly reduces risk. If checks are still running, wait or note the pending status.

### 4. Checkout and validate locally

```bash
gh pr checkout {{NUMBER}}
pnpm install
```

Run validation in order (stop on first failure):

1. `pnpm typecheck`
2. `pnpm test:affected` — if the change touches tested code
3. `pnpm test` — full suite
4. E2E (`cd packages/platform-ui && pnpm test:e2e:auth`) — only if the change touches UI framework, React, or Next.js

### 5. Handle failures

If tests fail, assess whether the fix is simple (< 15 min of work):

- **Yes**: fix it, commit, and note what you changed
- **No**: describe the problem clearly — what fails, why, and what fixing it would require

### 6. Recommend

Use exactly one of these verdicts:

- **MERGE** — tests pass, change is safe
- **MERGE after fix** — minor fix applied or needed, describe what
- **CLOSE** — breaking change too large, dependency unnecessary, or better to wait for a later version
- **HOLD** — depends on another PR, needs a human decision, or blocked by something

### 7. Report

Provide a one-sentence summary and wait for the merge/close decision. Format:

```
## Renovate: <package> <old> -> <new>

**Risk**: Low/Medium/High
**CI**: Passed / Failed / Pending
**Local validation**: typecheck OK, tests OK (N passed), e2e skipped
**Verdict**: MERGE / MERGE after fix / CLOSE / HOLD

<one sentence explaining why>
```

## Important

- Always return to the original branch after review: `git checkout -`
- Do not merge or close the PR yourself — only recommend
- For **High** risk changes, always run the full test suite including E2E
- If `pnpm install` changes the lockfile beyond what Renovate committed, note it
