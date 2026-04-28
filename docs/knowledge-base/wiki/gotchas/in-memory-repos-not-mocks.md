---
type: gotcha
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [gotcha, testing, repository-pattern, mocks]
---

**Don't mock Firestore in tests. Use in-memory repository doubles from `@mediforce/platform-core/testing`.**

## Symptom

- Tests mock `firebase-admin` or `firestore` directly.
- Brittle mocks drift from real repository behaviour.
- Changes to Firestore repositories don't get caught by tests until runtime.

## Cause

Repositories follow the [repository-pattern](../concepts/repository-pattern.md): interface in `platform-core`, Firestore impl in `platform-infra`, in-memory double in `platform-core/testing`. Mocking `firebase-admin` bypasses the interface entirely — tests verify nothing useful.

## Fix / workaround

```typescript
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  buildHumanTask,
  buildAgentRun,
} from '@mediforce/platform-core/testing';

const repo = new InMemoryProcessInstanceRepository();
const instance = buildProcessInstance({ status: 'paused' });
```

In-memory doubles implement the same interface — real behaviour, no Firestore.

## How to avoid next time

Writing a new test? Grep first:

```bash
grep -rn 'InMemory' packages/platform-core/src/testing/
grep -rn 'build.*({' packages/platform-core/src/testing/factories.ts
```

If no double exists for the repo you need, add it to `platform-core/testing/` alongside the interface. Don't mock.

## Sources

- `AGENTS.md` → "Test factories"
- `packages/platform-core/src/testing/factories.ts`
