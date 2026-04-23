---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, platform-core, schemas, foundation]
---

**Foundational package — Zod schemas, repository interfaces, and test factories for every domain entity; zero `@mediforce/*` dependencies.**

## Purpose

Owns the cross-cutting contracts used by every other package: domain schemas (process definitions, workflow definitions, agent runs, human tasks, handoffs, MCP bindings), repository interfaces, service interfaces (auth, notifications, user directory), and validation/parsing utilities. Foundation for the dependency graph — depends on nothing in `@mediforce/*`.

## Dependencies

- Internal: none
- External: `zod`, `yaml`

## Key exports

- **Schemas (Zod + inferred types)**: `ProcessDefinition`, `Step`, `Transition`, `Trigger`, `ProcessInstance`, `StepExecution`, `AuditEvent`, `ProcessConfig`, `AgentRun`, `HumanTask`, `HandoffEntity`, `Namespace`, `WorkflowDefinition`, `CoworkSession`, `AgentMcpBinding`, MCP server/tool catalog entries.
- **Repository interfaces**: `ProcessRepository`, `ProcessInstanceRepository`, `AuditRepository`, `HumanTaskRepository`, `HandoffRepository`, `CoworkSessionRepository`, `CronTriggerStateRepository`, `ToolCatalogRepository`, `AgentDefinitionRepository`.
- **Service interfaces**: `AuthService`, `NotificationService`, `UserDirectoryService`.
- **Utilities**: `parseProcessDefinition` (YAML), `validateProcessConfig`, `resolveEffectiveMcp`, `RbacService`, `handoffTypeRegistry`.
- **Testing** (`@mediforce/platform-core/testing`): in-memory repository doubles, factory builders (`buildProcessInstance`, `buildHumanTask`, `buildAgentRun`, etc.).

## Key internal modules

- `src/schemas/` — 40+ Zod schemas, including `workflow-definition.ts` (unions over agent, review, cowork, handoff step variants).
- `src/interfaces/` — repository and service contracts.
- `src/parser/` — YAML process definition parsing.
- `src/mcp/` — MCP server resolution + tool catalog validation.
- `src/validation/` — `ProcessConfig` validation against `ProcessDefinition`.
- `src/collaboration/` — handoff type registry, `RbacService`.
- `src/testing/` — in-memory doubles + factories.

## Relationships

- Consumed by: [`workflow-engine`](./workflow-engine.md), [`agent-runtime`](./agent-runtime.md), [`platform-infra`](./platform-infra.md), [`platform-ui`](./platform-ui.md), [`supply-intelligence-plugins`](./supply-intelligence-plugins.md).
- Depends on: nothing internal.

## Sources

- `packages/platform-core/src/index.ts` — barrel exports
- `packages/platform-core/src/schemas/workflow-definition.ts`
- `packages/platform-core/src/schemas/process-definition.ts`
- `packages/platform-core/src/testing/factories.ts`
- `packages/platform-core/package.json`
- `AGENTS.md` → "Package dependency graph"
