---
name: implement-spec
description: Implement a specification (or specific phases) end-to-end using coordinated subagents. Handles multi-phase spec implementation with unit tests, documentation, and code-review compliance. Use when the user says "implement spec", "implement SPEC-XXX", "implement phases", "build from spec", or "code the spec".
---

# Implement Spec

Implements a specification (or selected phases) end-to-end using coordinated subagents. Every code change MUST pass the code-review checklist before the phase is considered done.

## Pre-Flight

1. **Identify the spec**: Locate the target spec in `.ai/specs/`.
2. **Load context**: Read spec fully. Read all AGENTS.md files listed in the Task Router that match the affected modules/packages.
3. **Load code-review checklist**: Read `.ai/skills/code-review/references/review-checklist.md` — this is the acceptance gate for every phase.
4. **Load lessons**: Read `.ai/lessons.md` for known pitfalls.
5. **Scope phases**: If the user specifies phases (e.g. "phases 2-3"), filter to only those. Otherwise implement all phases sequentially.

## Implementation Workflow

For **each phase** in the spec, execute these steps:

### Step 1 — Plan the Phase

Read the phase from the spec. For each step within the phase:
- Identify files to create or modify
- Identify which AGENTS.md guides apply (use Task Router)
- List required conventions and patterns from the relevant AGENTS.md
- Note any cross-module impacts

Present a brief plan to the user before coding.

### Step 2 — Implement

Use subagents to parallelize independent work:
- **One subagent per independent file/component** when files don't depend on each other
- **Sequential execution** when there are dependencies (e.g., entity before API route before UI page)

For every piece of code, enforce these rules inline:

| Area | Rule |
|------|------|
| Types | No `any` — use zod + `z.infer` |
| Security | Validate all inputs, scope queries to tenant, never log secrets |
| API | Document endpoints, consistent error responses |
| i18n | No hardcoded user-facing strings |
| Imports | Package-level imports for cross-module references |
| Naming | Follow project conventions from AGENTS.md |

### Step 3 — Unit Tests

For every new feature/function:
- Create unit tests colocated with the source (`*.test.ts` or `__tests__/`)
- Test happy path + key edge cases + error paths
- Mock external dependencies
- Verify tests pass

### Step 4 — Documentation

For each new feature:
- Add/update locale files for new i18n keys if applicable
- Update relevant AGENTS.md if the feature introduces new patterns
- Update Task Router in root AGENTS.md if new modules/packages were added

### Step 5 — Self-Review (Code-Review Gate)

Before marking a phase complete, run a self-review against the checklist in `.ai/skills/code-review/references/review-checklist.md`. Also scan for anti-patterns:

```bash
grep -rn "any" --include="*.ts" --include="*.tsx"     # No `any` types
grep -rn "console.log" --include="*.ts"                # No leftover logs
grep -rn "TODO\|FIXME\|HACK" --include="*.ts"         # Unresolved markers
```

Fix any violations before proceeding to the next phase.

### Step 6 — Update Spec with Progress

After completing each phase, update the spec file:

```markdown
## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Foundation | Done | 2026-03-05 | All steps, tests passing |
| Phase 2 — API | In Progress | 2026-03-06 | Step 2 of 3 done |
| Phase 3 — UI | Not Started | — | — |
```

For the current phase, mark individual steps:

```markdown
### Phase 2 — Detailed Progress
- [x] Step 1: Create data models
- [x] Step 2: Implement API endpoints
- [ ] Step 3: Add validation
```

### Step 7 — Verification

After all targeted phases are complete:

1. **Type check**: `pnpm typecheck` — must pass
2. **Unit tests**: `pnpm test` — must pass
3. **Lint**: `pnpm lint` (if configured) — must pass
4. **Build**: `pnpm build` (if configured) — must pass

Report results to the user. If any check fails, fix and re-verify.

## Subagent Strategy

| Task | Agent Type | When |
|------|-----------|------|
| Research existing patterns | Explore | Before implementing unfamiliar patterns |
| Implement independent files | general-purpose (parallel) | When files have no dependencies on each other |
| Run tests | Bash | After each phase |
| Self-review | general-purpose | After each phase, against checklist |

**Concurrency rule**: Launch parallel subagents only for truly independent work. Sequential for dependent files.

## Rules

- MUST read the full spec before starting implementation
- MUST read all relevant AGENTS.md files before coding
- MUST pass every applicable code-review checklist item before marking a phase done
- MUST update the spec with implementation progress after each phase
- MUST run verification checks after final phase
- MUST create unit tests for all new behavioral code
- MUST NOT skip the self-review step — it is the quality gate
- MUST NOT introduce `any` types, hardcoded strings, or other anti-patterns
- MUST keep subagents focused — one task per subagent, clear boundaries
- MUST report blockers to the user immediately rather than working around them silently
