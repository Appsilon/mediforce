# AI-Assisted Development Process

How we use AI coding agents (Claude Code, Codex, etc.) to build Mediforce — and how the repo is structured to make that work well.

## Why This Matters

AI agents are powerful but context-dependent. Without structure, they guess, hallucinate conventions, and produce inconsistent code. With the right files in the right places, they become reliable collaborators that follow your project's actual patterns.

This isn't about trusting AI blindly — it's about giving it the right instructions so a human Tech Lead can delegate effectively and review confidently.

## How It Works

### The Instruction Hierarchy

```
CLAUDE.md (root)              ← Auto-loaded. Points to AGENTS.md
├── AGENTS.md (root)          ← Task Router + core rules. Always in context.
│   └── Task Router table     ← Maps "what am I doing" → "what to read"
├── packages/*/AGENTS.md      ← Per-package instructions (added as codebase grows)
├── .ai/lessons.md            ← Accumulated pitfalls. Loaded every session.
├── .ai/specs/AGENTS.md       ← When/how to write specs
└── .ai/skills/*/SKILL.md     ← On-demand workflows (invoked via /skill-name)
```

**Key principle:** Instructions live close to the code they describe. The root file stays small (< 230 lines) and routes to specific guides.

### The Agent Delegation Model

The main AI thread acts as a **Tech Lead** — it delegates execution to subagents and focuses on architecture, coherence, and review. See `AGENTS.md` for the full model.

### The Spec-First Workflow

For non-trivial features (3+ steps, architectural decisions, multi-file changes):

```
Idea → Spec (skeleton) → Open Questions gate → Full spec → Implementation → Tests → Review
```

**The Open Questions gate** is the key mechanism. When the AI encounters unknowns, it MUST stop and ask — not guess:

```markdown
## Open Questions
> Implementation blocked until resolved.

Q1: Should deleted records be soft-deleted or hard-deleted?
Q2: What's the max page size for the list endpoint?
```

Only after the developer answers does the AI proceed.

### Skills (Standardized Workflows)

Skills are reusable instruction sets invoked on demand:

| Skill | Invoke with | Purpose |
|-------|-------------|---------|
| `spec-writing` | `/spec-writing` | Write or review a specification |
| `implement-spec` | `/implement-spec` | Implement a spec end-to-end with subagents, tests, and self-review |
| `code-review` | `/code-review` | Review code changes against checklist |
| `create-agents-md` | `/create-agents-md` | Create or rewrite AGENTS.md files with correct tone and structure |

Each skill has a `SKILL.md` with step-by-step workflow and optional `references/` with templates and checklists.

### Lessons Learned

`.ai/lessons.md` accumulates concrete rules from past mistakes. The AI reads it at the start of every session and checks it during code review. After fixing a recurring bug, we add a rule that prevents recurrence.

## File Reference

| File | Purpose | When to modify |
|------|---------|----------------|
| `CLAUDE.md` | Entry point, loads AGENTS.md | Rarely — just a pointer |
| `AGENTS.md` | Task Router, conventions, core rules | When adding modules/packages or changing conventions |
| `.ai/lessons.md` | Pitfalls from past mistakes | After fixing a recurring bug |
| `.ai/specs/AGENTS.md` | Spec lifecycle rules | When changing the spec process |
| `.ai/specs/README.md` | Index of all specs | When creating a new spec |
| `.ai/specs/SPEC-*.md` | Individual specifications | Per the spec lifecycle |
| `.ai/skills/*/SKILL.md` | Workflow instructions | When improving a workflow |
| `.ai/skills/*/references/*` | Templates, checklists | When improving quality gates |

## Adding New Instructions

### When to create a new AGENTS.md

When a package or module has conventions that AI agents should follow. Place it at the package/module root. Add a row to the Task Router in root `AGENTS.md`.

### When to create a new skill

When you find yourself giving the same multi-step instructions repeatedly. A skill standardizes the workflow so every invocation is consistent.

### Writing style for instruction files

AGENTS.md files are **instructions**, not documentation:

```markdown
# Wrong
The module provides CRUD operations for managing processes.

# Right
Use `makeCrudRoute` for all CRUD endpoints. MUST export `openApi` from every route.
```

Every sentence tells the AI what to DO, what to REUSE, or what rules to FOLLOW.

