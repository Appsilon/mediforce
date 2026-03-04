# Spec Lifecycle

## When to Write a Spec

- **Create**: New module, significant feature, architecture change touching multiple files
- **Update**: Changing APIs, data models, workflows, permissions, cross-module behavior
- **Skip**: Small bug fixes, typo-only edits, isolated one-file refactors with no behavior change

## Naming Convention

`SPEC-{number}-{YYYY-MM-DD}-{title-kebab-case}.md`

Example: `SPEC-001-2026-03-04-process-engine-core.md`

## Required Sections (non-trivial specs)

1. **TLDR** — Key points, scope, concerns (3-5 bullets)
2. **Open Questions** — `Q1`, `Q2`... format. Hard stop until developer answers. Remove block once resolved.
3. **Overview** — What, why, audience
4. **Problem Statement**
5. **Proposed Solution** — With alternatives considered
6. **Architecture** — Diagrams, data flow, module boundaries
7. **Data Models** — Entity fields, relationships, constraints
8. **API Contracts** — METHOD /path + request/response
9. **Implementation Plan** — Phases (stories) → Steps (testable tasks). Each step yields a working app state.
10. **Risks & Impact** — Concrete failure scenarios with severity and mitigation
11. **Changelog** — `### [YYYY-MM-DD]` entries

## Open Questions Gate

The most important mechanism. AI MUST stop and wait for answers before proceeding:

```markdown
## Open Questions
> Implementation blocked until resolved.

Q1: Should deleted records be soft-deleted or hard-deleted?
Q2: What's the max page size for the list endpoint?
```

## Implementation Status Tracking

After implementing each phase, update the spec:

```markdown
## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Foundation | Done | 2026-03-04 | All steps, tests passing |
| Phase 2 — API | In Progress | 2026-03-05 | Step 3 pending |
```

## Rules

- **MUST** include Open Questions block if any unknowns exist — never guess
- **MUST** break implementation into phases where each phase yields working code
- **MUST** update spec changelog when modifying an existing spec
- **MUST** update Implementation Status table after each phase
