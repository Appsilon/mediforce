# Code Review Checklist

## 1. Architecture & Module Boundaries

- [ ] Dependencies flow in the right direction (see package graph in `AGENTS.md`)
- [ ] No cross-package imports via internal paths — use package-level exports only
- [ ] New files are in the correct location per project conventions
- [ ] No unnecessary coupling; shared code lives in shared packages

## 2. Security

- [ ] All user inputs validated with Zod schemas
- [ ] No SQL injection, XSS, or command injection vectors
- [ ] Secrets not hardcoded or logged — use env vars
- [ ] Auth checks on all protected API routes
- [ ] Error messages don't leak internal details to clients

## 3. Data Integrity

- [ ] Firestore queries are tenant-scoped where applicable
- [ ] Nullable fields handled defensively
- [ ] No unbounded reads (missing `.limit()`)

## 4. API Design

- [ ] RESTful conventions followed
- [ ] Consistent error response shape
- [ ] Pagination for list endpoints

## 5. Code Quality

- [ ] No `any` types — use Zod + `z.infer<typeof Schema>`
- [ ] No `console.log` in production code
- [ ] No commented-out code
- [ ] No one-letter variable names
- [ ] Explicit boolean comparisons (`=== true`, not just truthy)
- [ ] Scripts are Python, not bash

## 6. Testing

- [ ] New behavior has unit tests (colocated `__tests__/` or `*.test.ts`)
- [ ] UI features have E2E journey tests in `packages/platform-ui/e2e/journeys/`
- [ ] Tests cover happy path + key error paths
- [ ] No flaky timing dependencies

## 7. Error Handling

- [ ] No empty catch blocks (swallowed errors)
- [ ] Async errors propagated correctly
- [ ] User-facing error messages are helpful

## 8. Performance

- [ ] No N+1 query patterns
- [ ] No unbounded data fetches
- [ ] Heavy operations are async/background where appropriate

## Anti-Pattern Quick Scan

```bash
# Run in repo root before approving
grep -rn ": any" --include="*.ts" --include="*.tsx" packages/
grep -rn "console\.log" --include="*.ts" --include="*.tsx" packages/
grep -rn "TODO\|FIXME\|HACK" --include="*.ts" packages/
```
