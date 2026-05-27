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

## 5a. DRY / KISS — file-by-file, hunk-by-hunk

- [ ] No duplicated logic — same code shape repeated ≥3 times → extract.
- [ ] No premature abstractions — single-caller wrappers, "future-proof" layers that solve nothing now.
- [ ] No needless indirection — pass-through functions, re-exports of re-exports, config objects with one field.
- [ ] Each hunk is a *sensible* change — not a copy-paste of the adjacent file with one symbol renamed.
- [ ] No half-implemented branches, dangling TODOs, or scaffolding left from intermediate steps.

## 5b. Dead code & removal candidates

- [ ] Grep every new export — is it actually called? If not, delete.
- [ ] Grep every *removed* function — are call sites also gone? Stale references = bug.
- [ ] When the diff replaces feature A with feature B: is A actually deleted in this PR, or left rotting?
- [ ] Flag features/endpoints/UI elements that look obsolete now that the new code lands — **ask the user** before deleting.
- [ ] Old fixtures / mock data / dead config keys removed alongside the code that used them.

## 5c. Reuse existing repo mechanisms

- [ ] HTTP from browser → `@/lib/use-mediforce` / `apiFetch`, never raw `fetch`.
- [ ] Server-to-server → `Mediforce` client / `mediforce` CLI, never curl REST.
- [ ] Validation → existing Zod schemas in `platform-core`, not new ad-hoc shapes.
- [ ] Auth / tenancy / repo access → existing helpers, not hand-rolled.
- [ ] UI primitives → existing components / shadcn / sonner, not bespoke divs reimplementing what we have.
- [ ] Background work → BullMQ via `container-worker`, not setTimeout / setInterval.
- [ ] Workflow / agent orchestration → `workflow-engine` + `agent-runtime` primitives, not parallel implementations.
- [ ] Before approving any new helper: did you grep for an existing one? Note the search you ran.

## 5d. Comment quality

- [ ] Comments explain **why** — non-obvious constraints, invariants, gotchas, links to incidents/ADRs.
- [ ] No comments that restate the code (`// increment i`).
- [ ] No flowery / multi-paragraph prose where one line suffices.
- [ ] No docstrings added to code the diff didn't change.
- [ ] Self-documenting code wins: prefer a better name over a comment.
- [ ] No "Added for X flow" / "Used by Y" / issue-number comments — that belongs in the PR description.
- [ ] No section-title / banner comments (`// ---- POST /api/foo ----`, `// === Helpers ===`) — symbol names and file structure already delineate sections.
- [ ] No ephemeral plan numbering or migration history (`// Phase 2.5`, `// added in Phase 2.6`, `// pre-Phase-2.5 Server Action`, `// replaces the old action`). Plan phases are temporary scaffolding; describe the durable behavior/reason instead. Test: would this still make sense to a reader in two years who never saw the plan? If not, cut it — the history belongs in the PR description / changelog.

## 6. Testing

- [ ] New behavior has unit tests (colocated `__tests__/` or `*.test.ts`)
- [ ] UI features have L4 UI E2E journey tests in `packages/platform-ui/e2e/ui/` (real multi-step flows, not "is button visible")
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

## 9. Changelog

- [ ] Non-trivial change adds a bullet under `## [Unreleased]` in `CHANGELOG.md` (skip only for typos / single-line config / comment-only diffs; Renovate batches under `### Dependencies`).
- [ ] Bullet states the **effect** of the change, not the mechanic. Rejected style: "Refactored X into shared component", "Updated Y handler". Accepted style: "Agent output now consistent across surfaces — L2 steps finally show HTML report". Test: would a year-later reader, with PR link removed, understand why the change mattered?
- [ ] Placed in the right Keep-a-Changelog category (Added / Changed / Deprecated / Removed / Fixed / Security / Dependencies).
- [ ] No edits to dated `## [YYYY-MM-DD]` sections — those are historical.

## Anti-Pattern Quick Scan

```bash
# Run in repo root before approving
grep -rn ": any" --include="*.ts" --include="*.tsx" packages/
grep -rn "console\.log" --include="*.ts" --include="*.tsx" packages/
grep -rn "TODO\|FIXME\|HACK" --include="*.ts" packages/
```
