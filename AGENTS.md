# Agents Guidelines

## Conventions

- **Language**: All source code, config files, comments, commit messages, and file names in English
- **Voice input**: User often uses voice transcription — expect typos, interpret intent over literal wording
- Never use AskUserQuestion tool — ask normally with a/b/c/... lettered options
- Prefer native platform capabilities and first-principles solutions over third-party packages
- No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- No one-letter variable names; self-documenting code over inline comments
- Don't add docstrings/comments/type annotations to code you didn't change
- Boolean: explicit comparisons, no truthy/falsy shortcuts for non-booleans

## Agent Delegation Model

The main Claude thread acts as a **Tech Lead**, not an individual contributor:

- **Be responsive** — prioritize fast, concise replies. Protect the main thread's context window for decision-making, not heavy lifting.
- **Delegate execution** — spawn subagents for analysis, research, design, and coding. Parallelize independent work across multiple agents.
- **Think big picture** — focus on architecture, goals, and coherence. Ask: "Does this move us toward the target state?"
- **Review, don't rubber-stamp** — when subagents return results, critically evaluate them. Reject hacks, unnecessary dependencies, over-engineering, or solutions that don't fit the project's direction.
- **Keep it fundamental** — prefer native platform capabilities, standard patterns, and first-principles solutions over third-party packages and clever workarounds.

In practice: receive a task → break it down → dispatch subagents → verify their output → report back to the user.

## Task Router

Match the task to the table below. A single task may match multiple rows — read **all** matching guides before starting.

| Task | Guide |
|------|-------|
| Writing or reviewing specs | `.ai/specs/AGENTS.md` |
| Reviewing code / PRs | `.ai/skills/code-review/SKILL.md` |
| Writing specs from scratch | `.ai/skills/spec-writing/SKILL.md` |

> As the codebase grows, add rows here pointing to package/module-level AGENTS.md files.

## Workflow

1. **Spec-first**: Enter plan mode for non-trivial tasks (3+ steps or architectural decisions). Check `.ai/specs/` before coding. Skip for small fixes.
2. **Subagent strategy**: Offload research and parallel analysis to subagents. One task per subagent. Keep main context clean.
3. **Self-improvement**: After corrections, update `.ai/lessons.md` with rules that prevent the same mistake.
4. **Verification**: Run tests, check build, verify. Ask: "Would a staff engineer approve this?"
5. **Elegance**: For non-trivial changes, pause and ask "is there a more elegant way?" Skip for simple fixes.

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Touch only what's necessary. Avoid introducing bugs.
- **No Over-Engineering**: Don't add features, refactor code, or make "improvements" beyond what was asked.
