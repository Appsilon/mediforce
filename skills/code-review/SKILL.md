---
name: code-review
description: Review pull requests and code changes for architecture, security, conventions, and quality. Use when asked to review a PR, diff, or specific files.
allowed-tools: Bash, Read, Glob, Grep
metadata:
  version: "1.0"
  domain: development
  complexity: intermediate
  tags: review, quality, security, architecture
---

# Code Review

## Usage

```
/code-review          # review current branch changes vs main
/code-review 42       # review PR #42
```

## Workflow

1. **Get the diff** — `gh pr diff <number>` or `git diff main...HEAD`
2. **Classify files** — group by layer: API routes, UI components, data/schemas, config, tests
3. **Apply checklist** — go through `references/review-checklist.md` section by section
4. **Check test coverage** — verify behavioral changes have tests
5. **Output findings** — structured report with severity levels

## Output Format

```markdown
## Summary
[1-2 sentences on overall quality and readiness]

## Findings

### Critical (blocks merge)
- `file:line` — description

### High (should fix before merge)
- `file:line` — description

### Medium (improve if possible)
- `file:line` — description

### Low (suggestions)
- `file:line` — description

## Verdict
APPROVE / REQUEST CHANGES / NEEDS DISCUSSION
```

## Rules

- MUST check every changed file against the checklist
- MUST flag known project conventions from `AGENTS.md` (no `any`, explicit booleans, Python scripts, etc.)
- MUST NOT rubber-stamp — flag real issues, not just style preferences
- MUST include file:line references for all findings
- If no issues found in a category, omit it from the report
