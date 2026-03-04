# Code Review Checklist

## 1. Architecture & Module Boundaries

- [ ] No unnecessary coupling between modules
- [ ] Dependencies flow in the right direction
- [ ] Shared code lives in shared packages, not duplicated
- [ ] New files are in the correct location per project conventions

## 2. Security

- [ ] All user inputs validated (zod or equivalent)
- [ ] No SQL injection, XSS, or command injection vectors
- [ ] Secrets not hardcoded or logged
- [ ] Auth/authz checks on all protected endpoints
- [ ] Error messages don't leak internal details

## 3. Data Integrity

- [ ] Database operations are properly scoped (tenant isolation if applicable)
- [ ] Migrations are safe (no data loss, no breaking changes)
- [ ] Foreign keys and constraints are correct
- [ ] Nullable fields handled defensively

## 4. API Design

- [ ] RESTful conventions followed
- [ ] Request/response schemas documented
- [ ] Error responses are consistent
- [ ] Pagination for list endpoints

## 5. Code Quality

- [ ] No `any` types
- [ ] No `console.log` left in production code
- [ ] No commented-out code
- [ ] Functions are reasonably sized
- [ ] Variable names are descriptive
- [ ] No duplicate logic that should be extracted

## 6. Testing

- [ ] New behavior has tests
- [ ] Tests cover happy path and key error paths
- [ ] Tests are deterministic (no flaky timing, no external dependencies)
- [ ] Test names describe the expected behavior

## 7. Error Handling

- [ ] Errors are caught and handled appropriately
- [ ] No swallowed errors (empty catch blocks)
- [ ] User-facing errors are helpful
- [ ] Async errors propagated correctly

## 8. Performance

- [ ] No N+1 query patterns
- [ ] No unbounded data fetches (missing pagination/limits)
- [ ] No unnecessary re-renders in UI components
- [ ] Heavy operations are async/background when appropriate

## Anti-Pattern Quick Scan

```bash
grep -rn "any" --include="*.ts"          # No `any` types
grep -rn "console.log" --include="*.ts"  # No leftover logs
grep -rn "TODO\|FIXME\|HACK" --include="*.ts"  # Unresolved markers
```
