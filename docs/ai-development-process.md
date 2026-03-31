# AI-Assisted Development Process

How we use AI coding agents (Claude Code) to build Mediforce — and how the repo is structured to make that reliable.

## Why Structure Matters

AI agents are powerful but context-dependent. Without structure, they guess, skip steps, and produce inconsistent code. With the right instruction files, they behave like a disciplined senior engineer who reads the project conventions before touching anything.

The goal isn't to trust AI blindly — it's to give it clear enough instructions that a human Tech Lead can delegate confidently and review efficiently.

## The Instruction Hierarchy

```
CLAUDE.md (root)              ← Auto-loaded. Single line: @AGENTS.md
└── AGENTS.md (root)          ← Core rules, architecture, testing, skills router
      └── Skills Router       ← Maps "what am I doing" → "which skill to invoke"

skills/*/SKILL.md             ← On-demand workflows (invoked via /skill-name)
```

**Key principle:** Instructions live close to the code they describe. `AGENTS.md` is the single source of truth for how agents behave in this repo.

## The Agent Delegation Model

The main AI thread acts as a **Tech Lead** — not an individual contributor. It:

- Delegates execution to subagents (research, analysis, coding)
- Parallelizes independent work across multiple agents
- Reviews subagent output critically — rejects hacks, over-engineering, unnecessary deps
- Keeps context clean for architectural decisions, not line-by-line implementation

In practice: receive task → break it down → dispatch subagents → verify output → report back.

## Skills: Standardized Workflows

Skills are reusable instruction sets invoked on demand via `/skill-name`:

| Skill | When to invoke |
|-------|---------------|
| `/code-review` | Reviewing any PR or diff |
| `/e2e-test` | Writing or running E2E journey tests |
| `/agent-browser` | Visual verification of UI in a live browser |
| `/renovate-review` | Reviewing Renovate dependency update PRs |
| `/community` | Writing Discord updates from rough notes |
| `/generate-pitch` | Generating a Marp pitch deck |

Each skill has a `SKILL.md` with step-by-step workflow and optional `references/` with checklists and templates.

## Testing Workflow (TDD for UI Features)

UI features follow a tight loop:

1. **RED** — Write the E2E journey test first (`/e2e-test`)
2. **GREEN** — Implement until the test passes
3. **Record** — `pnpm test:e2e:gif` converts recordings to GIFs in `docs/features/`
4. **Gallery** — Add entry to `docs/features/FEATURES.md`
5. **Commit** — GIF + feature code + FEATURES.md in the same PR

GIF recordings are part of the deliverable, not an afterthought.

## Code Quality Gates

After every code change:

```bash
pnpm typecheck          # ~5s — catches type errors
pnpm test:affected      # <1s — tests for changed files only
pnpm test               # ~9s — full unit + integration suite
```

Before merging UI changes:
```bash
cd packages/platform-ui && pnpm test:e2e:auth   # ~60s — full E2E with emulators
```

## File Reference

| File | Purpose | When to modify |
|------|---------|----------------|
| `CLAUDE.md` | Entry point | Never — it's one line |
| `AGENTS.md` | Core rules, architecture, testing, skills router | When adding packages, changing conventions, or adding skills |
| `skills/*/SKILL.md` | Workflow instructions | When improving a repeatable workflow |
| `skills/*/references/*` | Checklists and templates | When improving quality gates |
| `skills/_registry.yml` | Skills index | When adding a new skill |
