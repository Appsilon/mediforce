---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [concept, repository-pattern, platform-core, platform-infra]
---

**Interfaces in `platform-core`, Firestore impls in `platform-infra`, in-memory doubles in `platform-core/testing`. Constructor injection — no global singletons inside repos.**

## Layers

Every persistent entity has four slots:

1. Zod schema in `packages/platform-core/src/schemas/`.
2. Repository interface in `packages/platform-core/src/interfaces/`.
3. Firestore impl in `packages/platform-infra/src/firestore/`.
4. In-memory double in `packages/platform-core/src/testing/`.

Covers: process definitions + instances, audit events, human tasks, handoffs, agent runs, cowork sessions, cron trigger state, tool catalog, agent definitions, namespaces.

Keeps workflow-engine + agent-runtime free of Firestore knowledge — they consume interfaces only.

## Before writing a new repo

- Check `packages/platform-core/src/interfaces/` for an existing interface to extend.
- Check `packages/platform-infra/src/firestore/` for a similar impl pattern.
- Check `packages/platform-core/src/testing/` for the double.

Reaching for direct Firestore access from workflow-engine / agent-runtime / plugins? **Stop.** Breaks the boundary. Add the interface to `platform-core` instead.

## Versioning invariant

Firestore process + workflow-definition repos are **write-once**. Overwrite → `DefinitionVersionAlreadyExistsError` / `ConfigVersionAlreadyExistsError`. See [`platform-infra`](../entities/packages/platform-infra.md).

## Testing

Never mock Firestore. Use `InMemory*Repository` from `@mediforce/platform-core/testing`:

```typescript
import { buildProcessInstance, buildHumanTask, buildAgentRun } from '@mediforce/platform-core/testing';
```

See [in-memory-repos-not-mocks gotcha](../gotchas/in-memory-repos-not-mocks.md).

## Sources

- `packages/platform-core/src/interfaces/`
- `packages/platform-infra/src/firestore/`
- `packages/platform-core/src/testing/factories.ts`
- `AGENTS.md` → "Key architectural patterns"
