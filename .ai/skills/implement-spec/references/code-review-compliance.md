# Code-Review Compliance Quick Reference

Condensed reference of the most common violations to check during implementation. For the full checklist, see `.ai/skills/code-review/references/review-checklist.md`.

## Critical (Must Fix — Blocks Merge)

| # | Check | How to Fix |
|---|-------|-----------|
| 1 | All user inputs validated with zod | Add zod schemas in validators |
| 2 | No SQL injection / XSS / command injection vectors | Use parameterized queries, sanitize output |
| 3 | Auth/authz checks on all protected endpoints | Add guards/middleware |
| 4 | Secrets not hardcoded or logged | Use env vars, redact in logs |
| 5 | No data leaks in error responses | Return generic messages, log details server-side |

## High (Should Fix Before Merge)

| # | Check |
|---|-------|
| 1 | No `any` types — use zod + `z.infer` |
| 2 | Changed behavior has test coverage |
| 3 | API endpoints have documented request/response schemas |
| 4 | No raw `console.log` in production code |
| 5 | Dependencies flow in the correct direction (no circular imports) |

## Medium (Improve If Possible)

| # | Check |
|---|-------|
| 1 | No hardcoded user-facing strings — use i18n |
| 2 | Functions are reasonably sized and focused |
| 3 | No duplicate logic that should be extracted |
| 4 | Error handling is consistent (no swallowed errors) |
| 5 | Loading/error states handled in UI |

## Anti-Pattern Quick Scan

Before marking a phase done, scan for these patterns in your diff:

```bash
grep -rn "any" --include="*.ts" --include="*.tsx"          # No `any` types
grep -rn "console.log" --include="*.ts" --include="*.tsx"  # No leftover logs
grep -rn "TODO\|FIXME\|HACK" --include="*.ts"             # Unresolved markers
grep -rn "password\|secret\|token" --include="*.ts"        # Potential secret exposure
```
