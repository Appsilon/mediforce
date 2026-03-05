---
name: create-agents-md
description: Create or rewrite AGENTS.md files for packages and modules. Use when adding a new package, creating a new module, or when an existing AGENTS.md needs to be created or refactored. Ensures prescriptive tone, MUST rules, checklists, and consistent structure.
---

Create prescriptive, action-oriented AGENTS.md files that tell agents **what to DO**, **what to REUSE**, and **what rules to FOLLOW**. Never write descriptive documentation — write instructions.

## Core Philosophy

AGENTS.md files are **not documentation**. They are **instruction sets for coding agents**. Every sentence should either:
- Tell the agent what to do ("Use X when...")
- Constrain the agent's behavior ("MUST NOT...")
- Give a step-by-step procedure ("1. Create... 2. Add... 3. Run...")

## File Structure Template

```markdown
# {Name} — Agent Guidelines

{One-line imperative directive: "Use X for Y." or "Use the Z module for A, B, and C."}

## MUST Rules

1. **MUST ...** — {consequence or rationale}
2. **MUST NOT ...** — {what to do instead}
3. **MUST ...** — {consequence or rationale}

## {Primary Task Section — "When You Need X" or "Adding a New Y"}

{Numbered checklist or decision table}

## {Secondary Sections}

{Tables with "When to use" / "When to modify" columns}

## Structure

{Directory tree — keep brief}

## Cross-References

- **For X**: `path/to/AGENTS.md` → Section
```

## Prescriptive Tone Rules

### NEVER start a section with

- "The module provides..."
- "This package is..."
- "This document describes..."
- "X is a Y that..."

### ALWAYS start sections with

- Imperative verbs: "Use", "Add", "Create", "Configure", "Declare", "Follow", "Resolve"
- Conditional directives: "When you need X, do Y"
- Constraints: "MUST", "MUST NOT"

### Transform Patterns

| Descriptive (BAD) | Prescriptive (GOOD) |
|---|---|
| "The cache module provides multi-strategy caching" | "Use `cache` for all caching. MUST NOT use raw Redis directly." |
| "Events support local and async dispatch" | "When `QUEUE_STRATEGY=async`, persistent events dispatch through the queue" |
| Description column in tables | "When to use" or "When to modify" column |

## MUST Rules Requirements

| File size | Minimum MUST rules |
|-----------|-------------------|
| Small (< 80 lines) | 3 |
| Medium (80-150 lines) | 5 |
| Large (150+ lines) | 8+ |

### Writing Effective MUST Rules

Pattern: `**MUST [verb]** — [rationale or consequence]`

Good:
- `**MUST validate all inputs with zod** — unvalidated input is the #1 security risk`
- `**MUST NOT import from internal paths** — use package-level exports only`
- `**MUST export metadata** with { queue, id } from every worker file`

Bad:
- `**MUST** follow best practices` (too vague)
- `**MUST** be careful with...` (not actionable)

## Table Column Conventions

### NEVER use these column headers
- "Description"
- "Purpose" (standalone)
- "Details"

### ALWAYS use these column headers

| Context | Use these columns |
|---------|-------------------|
| Feature tables | "When to use", "Configuration" |
| Directory listings | "When to modify" |
| File reference tables | "When you need", "Import from" |
| Entity/data model | Constraint-framed: "Entity — description. MUST [constraint]" |

## Checklist Sections

Include numbered checklists for common tasks:

```markdown
## Adding a New API Endpoint

1. Create route file in `src/routes/<method>/<path>.ts`
2. Add zod schema for request validation
3. Export OpenAPI documentation
4. Add auth guard if endpoint is protected
5. Write unit test covering happy path and error cases
6. Run `pnpm typecheck && pnpm test`
```

Every checklist MUST:
- Use numbered steps (not bullets)
- Start each step with an imperative verb
- End with a testing/verification step

## File Size Guidelines

| Type | Target lines |
|------|-------------|
| Small package | 40–80 |
| Medium module | 60–100 |
| Large package | 80–150 |
| Root AGENTS.md | Max 230 |

## After Creating an AGENTS.md

1. Update the Task Router table in root `AGENTS.md` with a row for the new package/module
2. Use descriptive task keywords (not just the package name)
3. Keep root AGENTS.md under 230 lines

## Verification Checklist

After writing an AGENTS.md, verify:

1. **Tone**: Every section starts with imperative verb or "When you need..."
2. **MUST audit**: File has required number of MUST rules (3+ small, 5+ medium, 8+ large)
3. **No descriptive openers**: No section starts with "The module provides..." or similar
4. **Tables**: All tables use "When to use" / "When to modify" columns, never "Description"
5. **Checklists**: Common tasks have numbered step-by-step procedures
6. **Cross-references**: No duplicated content between files; clear pointers instead
7. **Opening line**: File starts with one-line imperative directive, not a description

## Anti-Patterns

1. **Explaining how things work** instead of telling agents what to do
2. **Listing features** instead of listing constraints
3. **Duplicating content** across multiple AGENTS.md files
4. **Writing paragraphs** where a checklist would be clearer
5. **Over-documenting internals** — AGENTS.md guides usage, not implementation
6. **Missing the "when" framing** — every table/section should answer "when do I use this?"
