---
name: code-review
description: Review pull requests and code changes for architecture, security, conventions, and quality.
---

# Code Review

## Workflow

1. **Classify** — categorize each changed file by layer (API, UI, data, config, test)
2. **Load context** — read relevant AGENTS.md files + active specs + `.ai/lessons.md`
3. **Apply checklist** — go through `references/review-checklist.md` point by point
4. **Check test coverage** — verify behavioral changes have tests
5. **Output findings** — structured report with severity levels

## Output Format

```markdown
## Summary
[1-2 sentences on overall quality]

## Findings

### Critical
- [file:line] Description — fix required

### High
- [file:line] Description — should fix before merge

### Medium
- [file:line] Description — improve if possible

### Low
- [file:line] Description — suggestion
```

## Rules

- **MUST** read `.ai/lessons.md` and flag known pitfalls relevant to the diff
- **MUST** check every changed file against the checklist
- **MUST NOT** rubber-stamp — flag real issues, not just style preferences
- Report anti-patterns with specific file:line references
