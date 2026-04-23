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

### 6. Diagnose failures before recommending CLOSE

Never recommend CLOSE based only on surface symptoms (red check, failing test). Always dig to root cause first — the fix may be trivial (pnpm override, rebase) and not require closing at all.

Common failure modes and how to diagnose each:

| Symptom | Real root cause to check | How |
|---------|--------------------------|-----|
| `renovate/artifacts` FAILURE | Branch is stale vs main — peer pins in the branch lockfile conflict with newer versions merged on main since the PR was opened | `gh pr view <N> --json mergeable,headRefOid` → look for `CONFLICTING`. Count commits behind: `gh pr view <N> --json baseRefOid,headRefOid` then `git log --oneline <base>..main \| wc -l` |
| `Vercel` / prod build FAILURE but dev tests pass | Pre-existing prod bug on main, fixed after this PR's last commit — not caused by this PR | Compare PR's commit SHA timestamp against `git log main` for fix commits on build config (e.g., `next.config.mjs`, webpack aliases, transpile lists) |
| Runtime crash in e2e but unit tests pass | Duplicate transitive dependency — two copies of the same package at different versions, breaking identity checks (`instanceof`, `NodeProp`, singletons) | `pnpm why <transitive>` — look for multiple version lines. Diff the PR lockfile for `'<pkg>@X.Y.Z': {}` blocks that didn't exist before |
| Major version bump tests pass but risk is "high" | Override-only (pinned in `pnpm.overrides` for transitive deps), not a direct dependency — true blast radius is limited | `grep -n "<pkg>" package.json` — if it's only under `"overrides"` or `"pnpm.overrides"`, downgrade risk one level |

Cheap diagnostic commands to run before deciding:

```bash
# Is the branch stale vs main?
gh pr view <N> --json mergeable,mergeStateStatus,headRefOid,baseRefOid
# What actually changed in the lockfile?
gh pr diff <N> -- pnpm-lock.yaml | head -100
# Which failed check matters? Get the failure log:
gh run view <run-id> --log-failed | grep -iE "error|typeerror|cannot|failed" | head -40
# For Vercel/prod failures, fetch the target URL from the check
gh pr checks <N>
```

### 7. Recommend

Use exactly one of these verdicts:

- **MERGE** — tests pass, change is safe
- **MERGE after fix** — minor fix applied or needed, describe what
- **CLOSE** — breaking change too large, dependency unnecessary, or the branch is so stale that recreating is cleaner than rebasing
- **HOLD** — depends on another PR, needs a human decision, or blocked by something

### 8. Post a reasoning comment on the PR — always

Before the merge/close action, post a GitHub comment on the PR explaining the reasoning. This creates an audit trail so a human (or future-you) can understand *why* the decision was made without re-running the analysis.

**Structure (merge cases)** — short, one short paragraph:
- What was checked (CI state, scope of change, risk level)
- Why it's safe to merge (e.g., "override-only, transitive impact", "dev-only dep", "additive breaking change per changelog")

**Structure (close/hold cases)** — detailed, sectioned:
- `### Why closed — detailed diagnosis` header
- **Root cause** section naming the real problem (not the surface symptom)
- **Evidence** — specific SHAs, file paths, version numbers, stack traces
- **Fix path** — concrete options with pros/cons, so the next run knows what to do

Example merge comment:
```
Reviewed via `renovate-review` skill. `protobufjs` is pinned in `pnpm.overrides`,
transitive-only. Checked the v8 changelog — the only breaking change is added
Edition 2024 support (additive, nothing removed). Full CI green. Merging.
```

Example close comment (see PR #175 / #233 for full templates): always name the root cause in the first line, then evidence, then fix path.

Post via:
```bash
gh pr comment <N> --body "<markdown>"
```

### 9. Report

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
- **Always post a reasoning comment on the PR before the merge/close action** (see step 8)
- **Never close with `--delete-branch` on a PR you might want to reopen** — branch deletion makes reopen impossible without recreating the branch from the original commit SHA (`git push origin <sha>:refs/heads/<branch>` then `gh pr reopen`). If unsure, close without `--delete-branch`
- For **High** risk changes, always run the full test suite including E2E
- If `pnpm install` changes the lockfile beyond what Renovate committed, note it
- **Override-only deps are a special case**: a major bump of a package listed only under `pnpm.overrides` affects transitive consumers, not direct imports. Full CI passing is strong evidence — usually safe to merge even for major bumps
- **Duplicate transitive dep crashes** are almost always fixable with a single-line `pnpm.overrides` entry pinning the duplicated package to one version — try this before recommending CLOSE
