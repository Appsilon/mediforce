---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, migration, workflow-definitions, dual-schema]
---

**Legacy `processDefinitions` + `processConfigs` coexist with the unified `workflowDefinitions`. Resolution logic routes reads to whichever schema has the data. Live migration in progress.**

## Why it exists

The platform originally stored process logic in two Firestore collections: `processDefinitions` (structure) and `processConfigs` (per-step config). The unified `workflowDefinitions` collection merges both. Rather than a big-bang migration, the system resolves at read time.

## Where resolution happens

`packages/platform-ui/src/lib/resolve-definition-steps.ts` — the single resolver. It consults both schemas and returns a normalised `WorkflowDefinition`-shaped object. Every feature that reads steps goes through this function.

## Before writing new code

- Reading step definitions? **Use `resolveDefinitionSteps()`.** Do not hit `processDefinitions` or `workflowDefinitions` directly.
- Writing new workflow logic? **Write against `WorkflowDefinition` only** (Zod schema in [`platform-core`](../entities/packages/platform-core.md)). The legacy path is read-only.
- Migrating? Use the migration endpoints under `packages/platform-ui/src/app/api/migrations/`.

## Schema authority

`WorkflowDefinition` lives in `packages/platform-core/src/schemas/workflow-definition.ts`. Union type covering agent / review / cowork / handoff step variants.

## Immutability

All definition versions (both legacy and unified) are **write-once** in Firestore. Re-publishing increments the version. Enforced by [repository-pattern](./repository-pattern.md) errors: `DefinitionVersionAlreadyExistsError`.

## Sources

- `packages/platform-ui/src/lib/resolve-definition-steps.ts`
- `AGENTS.md` → "Key architectural patterns" → "Dual-schema migration"
