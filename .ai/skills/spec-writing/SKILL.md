---
name: spec-writing
description: Write or draft a specification. Use when starting a new SPEC or reviewing specs.
---

# Spec Writing

## Workflow

1. **Load context** — check Task Router in root `AGENTS.md`, identify which guides apply
2. **Create file** — `SPEC-{number}-{YYYY-MM-DD}-{title}.md` in `.ai/specs/`
3. **Write skeleton** — TLDR + 2-3 key sections only. STOP here if there are unknowns.
4. **Open Questions gate** — add numbered `Q1`, `Q2`... block. Hard stop until developer answers.
5. **After answers** — fill skeleton, remove questions block
6. **Research** — challenge requirements against existing solutions / market leaders
7. **Design** — full architecture, data models, API contracts
8. **Implementation plan** — break into Phases (stories) and Steps (testable tasks)
9. **Review** — apply `references/spec-checklist.md`
10. **Finalize** — write to file, add changelog entry, update `.ai/specs/README.md`

## Rules

- **MUST** write skeleton first, never jump to full spec
- **MUST** stop at Open Questions if any unknowns exist
- **MUST** break implementation into phases where each step yields working code
- **MUST** apply the checklist before finalizing
- Every phase should be independently mergeable when possible
