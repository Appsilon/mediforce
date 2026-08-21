---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, migration, workflow-definitions, dual-schema]
---

**Legacy `processDefinitions` + `processConfigs` coexist with unified `workflowDefinitions`. Read-time resolution. Live migration in progress.**

## Why

Originally: two Firestore collections — `processDefinitions` (structure) + `processConfigs` (per-step config). New: unified `workflowDefinitions`. No big-bang migration → system resolves at read time.

## Where resolution lives

`packages/platform-ui/src/lib/resolve-definition-steps.ts`. Single resolver. Consults both schemas → returns normalised `WorkflowDefinition`-shaped object. Every feature that reads steps goes through this.

## Before writing code

- Reading step definitions? **Use `resolveDefinitionSteps()`.** Never hit `processDefinitions` / `workflowDefinitions` Firestore directly. See [dual-schema-routing gotcha](../gotchas/dual-schema-routing.md).
- New workflow logic? **Write against `WorkflowDefinition` only.** Legacy = read-only.
- Migrating? `packages/platform-ui/src/app/api/migrations/`.

## Schema authority

`WorkflowDefinition` in `packages/platform-core/src/schemas/workflow-definition.ts`. Union over agent / review / cowork / handoff step variants.

## Immutability

All definition versions write-once in Firestore. Republish → version bump. Enforced via [repository-pattern](./repository-pattern.md): `DefinitionVersionAlreadyExistsError`.

## Sources

- `packages/platform-ui/src/lib/resolve-definition-steps.ts`
- `AGENTS.md` → "Key architectural patterns" → "Dual-schema migration"
