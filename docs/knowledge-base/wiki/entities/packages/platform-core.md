---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, platform-core, schemas, foundation]
---

**Foundation. Zod schemas + repository interfaces + test factories. Zero `@mediforce/*` deps.**

## Purpose

Cross-cutting contracts every other package consumes: domain schemas, repository + service interfaces, validation/parsing utils, in-memory test doubles. Bottom of dependency graph.

## Dependencies

- Internal: none.
- External: `zod`, `yaml`.

## Key exports

**Schemas (Zod + inferred types)**: `ProcessDefinition`, `Step`, `Transition`, `Trigger`, `ProcessInstance`, `StepExecution`, `AuditEvent`, `ProcessConfig`, `AgentRun`, `HumanTask`, `HandoffEntity`, `Namespace`, `WorkflowDefinition`, `CoworkSession`, `AgentMcpBinding`, MCP server/tool catalog entries.

**Repository interfaces**: `ProcessRepository`, `ProcessInstanceRepository`, `AuditRepository`, `HumanTaskRepository`, `HandoffRepository`, `CoworkSessionRepository`, `CronTriggerStateRepository`, `ToolCatalogRepository`, `AgentDefinitionRepository`.

**Service interfaces**: `AuthService`, `NotificationService`, `UserDirectoryService`.

**Utilities**: `parseProcessDefinition` (YAML), `validateProcessConfig`, `resolveEffectiveMcp`, `RbacService`, `handoffTypeRegistry`.

**Testing** (`@mediforce/platform-core/testing`): in-memory repos + factories (`buildProcessInstance`, `buildHumanTask`, `buildAgentRun`, …).

## Key internal modules

- `src/schemas/` — 40+ Zod schemas. `workflow-definition.ts` = union over agent/review/cowork/handoff variants.
- `src/interfaces/` — repo + service contracts.
- `src/parser/` — YAML process-def parsing.
- `src/mcp/` — MCP server resolution + catalog validation.
- `src/validation/` — `ProcessConfig` vs `ProcessDefinition`.
- `src/collaboration/` — handoff registry, `RbacService`.
- `src/testing/` — in-memory doubles + factories.

## Relationships

- Consumed by: [`workflow-engine`](./workflow-engine.md), [`agent-runtime`](./agent-runtime.md), [`platform-infra`](./platform-infra.md), [`platform-ui`](./platform-ui.md), [`supply-intelligence-plugins`](./supply-intelligence-plugins.md).
- Depends on: nothing internal.

## Sources

- `packages/platform-core/src/index.ts`
- `packages/platform-core/src/schemas/workflow-definition.ts`
- `packages/platform-core/src/schemas/process-definition.ts`
- `packages/platform-core/src/testing/factories.ts`
- `packages/platform-core/package.json`
- `AGENTS.md` → "Package dependency graph"
