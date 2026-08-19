---
status: living
audience: everyone
last_reviewed: 2026-08-19
---

# AI-Assisted Development Process

How we use AI coding agents to build Mediforce — and how the repo is structured to make that work.

AI agents are context-dependent: without structure they guess at conventions and produce inconsistent code. The fix is not trusting the agent more, it is putting the right instructions in the places the agent already reads, so a human Tech Lead can delegate and review with confidence.

## How It Works

### The Instruction Hierarchy

```
CLAUDE.md (root)              ← Auto-loaded by Claude. One line: points to AGENTS.md
└── AGENTS.md (root)          ← Per-task workflow + cross-cutting rules

CONTEXT.md (root)             ← Domain vocabulary — what our terms mean

skills/<name>/SKILL.md        ← On-demand workflows (invoked via /skill-name)
skills/<name>/references/     ← Checklists and templates used by a skill
skills/_registry.yml          ← Hand-maintained index of the skills above
.claude/skills/<name>         ← Symlink → skills/<name>. Claude reads descriptions here

agents/<name>.md              ← Custom subagent definitions (design, discuss-vision)
.claude/agents/               ← Symlink → ../agents
```

**Key principle:** `AGENTS.md` carries workflow and rules only — what to DO and what NOT to do. Every "how to do X" lives in a skill, so the always-loaded file stays a set of rules rather than a manual. There is no manual skills router: Claude reads every skill's `description:` from `.claude/skills/` at session start and routes on the natural-language triggers written into that description.

### The Agent Delegation Model

The main AI thread acts as a **Tech Lead** — it delegates execution to subagents and keeps ownership of architecture, coherence, and review.

- **Delegate execution** — spawn subagents for research, analysis, and coding. Parallelize independent work.
- **Think big picture** — architecture, goals, and coherence, not line-by-line implementation.
- **Review, don't rubber-stamp** — reject hacks, unnecessary dependencies, over-engineering, and solutions that don't fit the project's direction.

In practice: receive task → break it down → dispatch subagents → verify actual output → report back. Owning the outcome means checking what the subagent really produced, not avoiding delegation to feel safe.

### Skills (Standardized Workflows)

Skills are reusable, on-demand instruction sets. Browse the live catalog in
[`skills/_registry.yml`](../../skills/_registry.yml) or with
`ls .claude/skills/`; do not maintain a second list here. Each skill owns its
procedure in `SKILL.md` and may carry checklists or templates under `references/`.

### Testing

Tests come first, at the lowest level that gives real signal — `/new-test` picks the level and walks RED → GREEN, `/e2e-test` handles L4 UI journeys. Product features must land at **L3** (proves storage backend + middleware + auth). Infrastructure and tooling — CI scripts, build glue, `workflow.yaml` configs — are exercised by the thing they support and don't get their own tests.

Commands, levels, and how long each gate takes: [`start/dev-quickref.md`](../start/dev-quickref.md). Level definitions and the rules behind them: [`testing/e2e-strategy.md`](../testing/e2e-strategy.md).

## Adding New Instructions

### When to create a new skill

When you catch yourself giving the same multi-step instructions repeatedly. Add the skill to `skills/`, list it in `skills/_registry.yml`, and symlink it into `.claude/skills/`. The symlink is what makes Claude auto-load the description at session start — no `AGENTS.md` edit is needed unless a cross-cutting rule changes.

Custom subagents live in `agents/`; `.claude/agents/` is a directory symlink, so
there is one copy to maintain.

### Writing style for instruction files

`AGENTS.md` and skill files are **instructions**, not documentation:

```markdown
# Wrong
The module provides CRUD operations for managing processes.

# Right
Use `makeCrudRoute` for all CRUD endpoints. MUST export `openApi` from every route.
```

Every sentence tells the agent what to DO, what to REUSE, or what rule to FOLLOW. For the terseness rules that apply to agent-facing files — and the exemptions for human-facing prose — see [`contributing/doc-style.md`](doc-style.md).
