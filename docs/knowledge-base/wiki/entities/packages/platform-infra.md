---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [package, platform-infra, firestore, firebase]
---

**Firebase/Firestore infrastructure layer — concrete repository implementations, auth services, notification senders, and secrets cipher.**

## Purpose

Implements the repository interfaces from `platform-core` against Firestore and wraps Firebase Auth. Encapsulates collection/document shape, immutable version constraints, dual client-vs-admin SDK initialisation, and notification delivery (SendGrid + webhooks). Constructor-injected into services — no global singletons.

## Dependencies

- Internal: [`platform-core`](./platform-core.md)
- External: `firebase`, `firebase-admin`, `@sendgrid/mail`

## Key exports

- **Repositories**: `FirestoreProcessRepository`, `FirestoreProcessInstanceRepository`, `FirestoreAuditRepository`, `FirestoreAgentRunRepository`, `FirestoreHumanTaskRepository`, `FirestoreAgentDefinitionRepository`, `FirestoreNamespaceRepository`, `FirestoreCoworkSessionRepository`, `FirestoreCronTriggerStateRepository`, `FirestoreToolCatalogRepository`.
- **Auth**: `FirebaseAuthService`, `FirebaseUserDirectoryService`, `FirebaseInviteService`.
- **Configuration**: `initializeFirebase`, `getFirestoreDb`, `getFirebaseAuth`, `getAdminFirestore`, `getAdminAuth`.
- **Crypto**: `validateSecretsKey` (HMAC validation for encrypted workflow secrets).
- **Errors**: `DefinitionVersionAlreadyExistsError`, `ConfigVersionAlreadyExistsError` — enforce write-once semantics (see [repository-pattern concept](../../concepts/repository-pattern.md)).

## Key internal modules

- `src/firestore/` — one repository per domain entity.
- `src/auth/` — Firebase Auth wrappers, user directory, invite service.
- `src/config/firebase-init.ts` — dual mode (client SDK vs admin SDK) init.
- `src/crypto/secrets-cipher.ts` — HMAC validation.
- `src/notifications/` — SendGrid + webhook delivery.
- `src/__tests__/` — repository CRUD, versioning, auth claims, cipher.

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md).
- Depends on: [`platform-core`](./platform-core.md).
- Does **not** depend on: workflow-engine, agent-runtime, supply-intelligence.

## Sources

- `packages/platform-infra/src/index.ts`
- `packages/platform-infra/src/config/firebase-init.ts`
- `packages/platform-infra/src/firestore/process-repository.ts`
- `packages/platform-infra/src/__tests__/process-repository.test.ts`
- `AGENTS.md` → "Key architectural patterns" (repository pattern, immutable versions)
