---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [app, workflow-designer, meta-workflow]
---

**Meta-workflow app that designs new Mediforce `WorkflowDefinition`s via AI + human review. Three workflow variants shipped (base, cowork, voice).**

## Purpose

Bootstraps new workflows. User describes an idea in natural language; an agent generates a candidate `WorkflowDefinition` JSON; human reviews and approves; the system registers it. Role-gated: `workflow-designer` role required.

## Workflow definitions

- `apps/workflow-designer/src/workflow-designer.wd.json` — base
- `apps/workflow-designer/src/cowork-workflow-designer.wd.json` — co-authoring variant
- `apps/workflow-designer/src/voice-workflow-designer.wd.json` — voice input variant

Partial step list (base):
1. `choose-mode` (human) — create-new vs edit-existing
2. `describe-idea` (human) — natural language + workflow name
3. `fetch-workflows` (agent) — list available workflows
4. `design-steps` (agent) — generate WorkflowDefinition JSON
5. `human-review` (human) — approve / reject
6. `register` (agent) — validate + register

## Relationships

- Produces: `WorkflowDefinition` entries consumed by [`workflow-engine`](../packages/workflow-engine.md) and [`platform-ui`](../packages/platform-ui.md).
- Schema authority: `WorkflowDefinition` lives in [`platform-core`](../packages/platform-core.md) `src/schemas/workflow-definition.ts`.

## Sources

- `apps/workflow-designer/src/workflow-designer.wd.json`
- `apps/workflow-designer/src/cowork-workflow-designer.wd.json`
