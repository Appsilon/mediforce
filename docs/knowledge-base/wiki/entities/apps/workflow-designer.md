---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [app, workflow-designer, meta-workflow]
---

**Meta-workflow. Designs new `WorkflowDefinition`s via AI + human review. Three variants (base, cowork, voice). Role-gated: `workflow-designer`.**

## Workflow definitions

- `apps/workflow-designer/src/workflow-designer.wd.json` — base
- `apps/workflow-designer/src/cowork-workflow-designer.wd.json` — co-authoring variant
- `apps/workflow-designer/src/voice-workflow-designer.wd.json` — voice input variant

## Steps (base)

1. `choose-mode` (human) — create-new vs edit-existing
2. `describe-idea` (human) — natural language + name
3. `fetch-workflows` (agent) — list available
4. `design-steps` (agent) — generate `WorkflowDefinition` JSON
5. `human-review` (human) — approve / reject
6. `register` (agent) — validate + register

## Relationships

- Produces: `WorkflowDefinition` entries consumed by [workflow-engine](../packages/workflow-engine.md) + [platform-ui](../packages/platform-ui.md).
- Schema authority: `WorkflowDefinition` in [platform-core](../packages/platform-core.md) `src/schemas/workflow-definition.ts`.

## Sources

- `apps/workflow-designer/src/workflow-designer.wd.json`
- `apps/workflow-designer/src/cowork-workflow-designer.wd.json`
