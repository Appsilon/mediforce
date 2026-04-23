---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [concept, repository-pattern, platform-core, platform-infra]
---

**Interfaces in `platform-core`, concrete Firestore implementations in `platform-infra`, in-memory test doubles in `platform-core/testing`. Constructor injection — no global singletons inside repositories.**

## Definition

Every persistent entity (process definitions, instances, audit events, human tasks, handoffs, agent runs, cowork sessions, cron trigger state, tool catalog, agent definitions, namespaces) has:

1. A Zod schema in `packages/platform-core/src/schemas/`.
2. A repository interface in `packages/platform-core/src/interfaces/`.
3. A Firestore implementation in `packages/platform-infra/src/firestore/`.
4. An in-memory double in `packages/platform-core/src/testing/`.

This keeps business logic (workflow-engine, agent-runtime) free of Firestore knowledge — they consume the interfaces only.

## Before writing a new repository

- Check `packages/platform-core/src/interfaces/` for an existing interface you can extend.
- Check `packages/platform-infra/src/firestore/` for a similar implementation pattern.
- Check `packages/platform-core/src/testing/` for a test double to match.

If you're reaching for direct Firestore access from `workflow-engine`, `agent-runtime`, or plugins — stop. That breaks the boundary. Add the interface to `platform-core` instead.

## Versioning invariant

`FirestoreProcessRepository` and workflow-definition repositories enforce **write-once versioning** — throw `DefinitionVersionAlreadyExistsError` / `ConfigVersionAlreadyExistsError` on overwrite. See [`platform-infra`](../entities/packages/platform-infra.md).

## Testing implications

Never mock Firestore directly. Use `InMemory*Repository` doubles from `@mediforce/platform-core/testing`:

```typescript
import { buildProcessInstance, buildHumanTask, buildAgentRun } from '@mediforce/platform-core/testing';
```

See `AGENTS.md` → "Test factories".

## Sources

- `packages/platform-core/src/interfaces/`
- `packages/platform-infra/src/firestore/`
- `packages/platform-core/src/testing/factories.ts`
- `AGENTS.md` → "Key architectural patterns"
