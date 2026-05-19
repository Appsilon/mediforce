# AI-Assisted Development Process

How we use AI coding agents to build Mediforce — and how the repo is structured to make that work well.

## Why This Matters

AI agents are powerful but context-dependent. Without structure, they guess, hallucinate conventions, and produce inconsistent code. With the right files in the right places, they become reliable collaborators that follow your project's actual patterns.

This isn't about trusting AI blindly — it's about giving it the right instructions so a human Tech Lead can delegate effectively and review confidently.

## How It Works

### The Instruction Hierarchy

```
CLAUDE.md (root)              ← Auto-loaded. Points to AGENTS.md
└── AGENTS.md (root)          ← Per-task workflow + cross-cutting rules (~100 lines)

skills/*/SKILL.md             ← On-demand workflows (invoked via /skill-name)
.claude/skills/<name>         ← Symlink — Claude auto-discovers descriptions at session start
skills/*/references/          ← Checklists, templates used by skills
```

**Key principle:** AGENTS.md stays under ~100 lines — workflow + rules only. Every "how to do X" lives in a skill. No manual Skills Router: Claude auto-loads every skill's `description:` from `.claude/skills/` at session start, and routes from natural-language triggers in the description itself.

### The Agent Delegation Model

The main AI thread acts as a **Tech Lead** — it delegates execution to subagents and focuses on architecture, coherence, and review.

- **Delegate execution** — spawn subagents for research, analysis, and coding. Parallelize independent work.
- **Think big picture** — focus on architecture, goals, and coherence, not line-by-line implementation.
- **Review, don't rubber-stamp** — reject hacks, unnecessary dependencies, over-engineering, and solutions that don't fit the project's direction.

In practice: receive task → break it down → dispatch subagents → verify output → report back.

### Skills (Standardized Workflows)

Skills are reusable instruction sets invoked on demand via `/skill-name`. Each skill's `description:` frontmatter contains trigger phrases — Claude auto-routes from natural language to the matching skill without any manual router. To browse: `ls .claude/skills/`.

| Skill | Purpose |
|-------|---------|
| `/new-test` | Pick the right test level (L1-L5), scaffold the file, walk RED → GREEN |
| `/self-review` | Pre-PR check (typecheck + affected tests + diff + code-review). MUST run as subagent |
| `/mediforce` | mediforce CLI, dev environment, REST fallback ladder, adding a CLI command |
| `/grill-with-docs` | Optional planning skill — interview-style stress test of a plan against CONTEXT.md / ADRs, sharpens fuzzy terms before coding (from [mattpocock/skills](https://github.com/mattpocock/skills)) |
| `/code-review` | Review PRs and diffs against an 8-section checklist (security, architecture, testing, etc.) |
| `/e2e-test` | Write, run, and record L4 UI journey tests with GIF + gallery update |
| `/agent-browser` | Visual verification of UI in a live browser |
| `/renovate-review` | Triage and validate Renovate dependency PRs |
| `/discord-update` | Write Discord updates from rough notes |
| `/add-changelog-entry` | Append a one-line entry to CHANGELOG.md under `[Unreleased]` |
| `/knowledge-base` | Ingest, query, and lint the LLM-compiled wiki |
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

When you find yourself giving the same multi-step instructions repeatedly. A skill standardizes the workflow so every invocation is consistent. Add the skill to `skills/`, register it in `_registry.yml`, and symlink it into `.claude/skills/`. The symlink is what makes Claude auto-load the skill's description at session start — no edit to `AGENTS.md` needed unless the workflow itself changes.

### Writing style for instruction files

`AGENTS.md` and skill files are **instructions**, not documentation:

```markdown
# Wrong
The module provides CRUD operations for managing processes.

# Right
Use `makeCrudRoute` for all CRUD endpoints. MUST export `openApi` from every route.
```

Every sentence tells the agent what to DO, what to REUSE, or what rules to FOLLOW.
