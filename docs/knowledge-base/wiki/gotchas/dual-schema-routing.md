---
type: gotcha
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [gotcha, workflow-definitions, dual-schema, routing]
---

**Reading workflow steps? Go through `resolveDefinitionSteps()`. Never hit `processDefinitions` or `workflowDefinitions` Firestore collections directly.**

## Symptom

- New feature works on new `workflowDefinitions`-backed workflows but silently breaks on legacy workflows.
- Or vice versa.
- "But the workflow exists — why do reads come back empty?"

## Cause

Two schemas coexist: legacy `processDefinitions` + `processConfigs` (pre-migration) and unified `workflowDefinitions` (post-migration). Different workflows live in different collections during the live migration. See [dual-schema-migration concept](../concepts/dual-schema-migration.md).

## Fix / workaround

- Every read of step definitions: **`resolveDefinitionSteps()`** in `packages/platform-ui/src/lib/resolve-definition-steps.ts`.
- That function consults both schemas and returns a normalised `WorkflowDefinition`-shaped object.
- Writes: new code only targets `workflowDefinitions`. Legacy is read-only.

## How to avoid next time

Before writing any Firestore query for step data, grep for `resolveDefinitionSteps` — chances are the code you need already exists.

```bash
grep -rn 'resolveDefinitionSteps' packages/
```

## Sources

- `packages/platform-ui/src/lib/resolve-definition-steps.ts`
- `AGENTS.md` → "Key architectural patterns" → "Dual-schema migration"
