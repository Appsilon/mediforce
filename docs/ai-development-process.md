# AI-Assisted Development Process

How we use AI coding agents to build Mediforce — and how the repo is structured to make that work well.

## Why This Matters

AI agents are powerful but context-dependent. Without structure, they guess, hallucinate conventions, and produce inconsistent code. With the right files in the right places, they become reliable collaborators that follow your project's actual patterns.

This isn't about trusting AI blindly — it's about giving it the right instructions so a human Tech Lead can delegate effectively and review confidently.

## How It Works

### The Instruction Hierarchy

```
CLAUDE.md (root)              ← Auto-loaded. Points to AGENTS.md
└── AGENTS.md (root)          ← Core rules, architecture, testing, skills router
      └── Skills Router       ← Maps "what am I doing" → "which skill to invoke"

skills/*/SKILL.md             ← On-demand workflows (invoked via /skill-name)
skills/*/references/          ← Checklists, templates used by skills
```

**Key principle:** Instructions live close to the code they describe. The root `AGENTS.md` stays under 300 lines and routes to specific skills for deep workflows.

### The Agent Delegation Model

The main AI thread acts as a **Tech Lead** — it delegates execution to subagents and focuses on architecture, coherence, and review.

- **Delegate execution** — spawn subagents for research, analysis, and coding. Parallelize independent work.
- **Think big picture** — focus on architecture, goals, and coherence, not line-by-line implementation.
- **Review, don't rubber-stamp** — reject hacks, unnecessary dependencies, over-engineering, and solutions that don't fit the project's direction.

In practice: receive task → break it down → dispatch subagents → verify output → report back.

### Skills (Standardized Workflows)

Skills are reusable instruction sets invoked on demand via `/skill-name`. The Skills Router in `AGENTS.md` maps task types to the right skill:

| Skill | Purpose |
|-------|---------|
| `/code-review` | Review PRs and diffs against an 8-section checklist (security, architecture, testing, etc.) |
| `/e2e-test` | Write, run, and record E2E journey tests with TDD workflow |
| `/agent-browser` | Visual verification of UI in a live browser |
| `/renovate-review` | Triage and validate Renovate dependency PRs |
| `/community` | Write Discord updates from rough notes |
| `/generate-pitch` | Generate a Marp pitch deck from vision docs |

Each skill has a `SKILL.md` with step-by-step workflow and optional `references/` with templates and checklists.

### Testing: TDD with GIF Recordings

UI features follow a tight TDD loop where the E2E test comes first and the GIF recording is part of the deliverable:

1. **RED** — Write the E2E journey test first
2. **GREEN** — Implement until the test passes
3. **Record** — Convert test recordings to GIFs in `docs/features/`
4. **Gallery** — Add entry to `docs/features/FEATURES.md`
5. **Ship** — GIF + feature code + gallery update in the same PR

Quality gates run after every change: typecheck (~5s), affected tests (<1s), full suite (~9s). E2E with Firebase emulators (~60s) before merging UI changes.

## Adding New Instructions

### When to create a new skill

When you find yourself giving the same multi-step instructions repeatedly. A skill standardizes the workflow so every invocation is consistent. Add the skill to `skills/`, register it in `_registry.yml`, symlink it into `.claude/skills/`, and add a row to the Skills Router in `AGENTS.md`.

### Writing style for instruction files

`AGENTS.md` and skill files are **instructions**, not documentation:

```markdown
# Wrong
The module provides CRUD operations for managing processes.

# Right
Use `makeCrudRoute` for all CRUD endpoints. MUST export `openApi` from every route.
```

Every sentence tells the agent what to DO, what to REUSE, or what rules to FOLLOW.
