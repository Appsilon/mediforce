---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, platform-infra, firestore, firebase]
---

**Firebase/Firestore infra layer. Concrete repos, auth services, notifications, secrets cipher.**

## Purpose

Implements repo interfaces from `platform-core` against Firestore. Wraps Firebase Auth. Owns collection/doc shape, immutable version constraints, dual client-vs-admin SDK init, notification delivery (SendGrid + webhooks). Constructor-injected. No global singletons inside repos.

## Dependencies

- Internal: [`platform-core`](./platform-core.md).
- External: `firebase`, `firebase-admin`, `@sendgrid/mail`.

## Key exports

- **Repositories**: `FirestoreProcessRepository`, `FirestoreProcessInstanceRepository`, `FirestoreAuditRepository`, `FirestoreAgentRunRepository`, `FirestoreHumanTaskRepository`, `FirestoreAgentDefinitionRepository`, `FirestoreNamespaceRepository`, `FirestoreCoworkSessionRepository`, `FirestoreCronTriggerStateRepository`, `FirestoreToolCatalogRepository`.
- **Auth**: `FirebaseAuthService`, `FirebaseUserDirectoryService`, `FirebaseInviteService`.
- **Config**: `initializeFirebase`, `getFirestoreDb`, `getFirebaseAuth`, `getAdminFirestore`, `getAdminAuth`.
- **Crypto**: `validateSecretsKey` (HMAC for workflow secrets).
- **Errors**: `DefinitionVersionAlreadyExistsError`, `ConfigVersionAlreadyExistsError` — write-once enforcement → see [repository-pattern](../../concepts/repository-pattern.md).

## Key internal modules

- `src/firestore/` — one repo per domain entity.
- `src/auth/` — Firebase Auth wrappers, user directory, invites.
- `src/config/firebase-init.ts` — client vs admin SDK init.
- `src/crypto/secrets-cipher.ts` — HMAC validation.
- `src/notifications/` — SendGrid + webhooks.
- `src/__tests__/` — repo CRUD, versioning, auth, cipher.

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md).
- Depends on: [`platform-core`](./platform-core.md).
- **Does not** depend on: workflow-engine, agent-runtime, supply-intelligence.

## Sources

- `packages/platform-infra/src/index.ts`
- `packages/platform-infra/src/config/firebase-init.ts`
- `packages/platform-infra/src/firestore/process-repository.ts`
- `packages/platform-infra/src/__tests__/process-repository.test.ts`
- `AGENTS.md` → "Key architectural patterns" (repository pattern, immutable versions)
