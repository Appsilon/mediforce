---
type: gotcha
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [gotcha, skills, runtime, workflow-definitions]
---

**Runtime skills live at `apps/*/plugins/*/skills/`. Paths are hardcoded in `*.wd.json` via `skillsDir`. Don't move them.**

## Symptom

- Rename or relocate a runtime skill directory.
- Workflow fails at step execution: `BaseContainerAgentPlugin.readSkillFile()` can't find the skill.

## Cause

Agent-runtime resolves skills via `skillsDir` field in the `WorkflowDefinition` JSON. That field is a literal path, not a registry lookup. Read by `BaseContainerAgentPlugin.readSkillFile()` at step execution time.

## Fix / workaround

- **Don't** move runtime skills without updating every `*.wd.json` that references the directory.
- **Don't** confuse runtime skills (`apps/*/plugins/*/skills/`) with development skills (`skills/` + `.claude/skills/` symlinks).

Two tiers — different resolution:

| Tier | Location | Resolved by |
|------|----------|-------------|
| Runtime | `apps/*/plugins/*/skills/` | `agent-runtime` via `skillsDir` in `.wd.json` |
| Development | `skills/` (symlinked to `.claude/skills/`) | Claude Code slash-command loader |

## How to avoid next time

Each app has its own runtime `_registry.yml` — that's the index for that app's runtime skills:

- `apps/protocol-to-tfl/plugins/protocol-to-tfl/skills/_registry.yml`
- `apps/community-digest/plugins/community-digest/skills/_registry.yml`
- `apps/workflow-designer/plugins/workflow-designer/skills/_registry.yml`

Before refactoring, grep for `skillsDir`: `grep -rn 'skillsDir' apps/ packages/`.

## Sources

- `AGENTS.md` → "Skills and Agents"
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts` (`readSkillFile`)
