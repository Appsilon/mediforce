import { createPostgresClient, PostgresNamespaceRepository } from '@mediforce/platform-infra';
import type { Namespace, NamespaceMember } from '@mediforce/platform-core';
import { TEST_ORG_HANDLE } from './constants';
import { buildSeedData } from './seed-data';

/**
 * Postgres mirror of the Firestore `namespaces` + `namespaces/{handle}/members`
 * seeds written in `auth-setup.ts`. Invoked only when `STORAGE_BACKEND=postgres`
 * so the regular emulator-only `e2e-tests` job is unaffected (ADR-0001 PR2).
 *
 * Reuses `buildSeedData` so the Postgres-side fixture stays byte-for-byte
 * identical to the Firestore-side fixture — no drift between backends.
 *
 * Idempotent: `auth-setup` may run multiple times against the same DB
 * locally. Each entity is pre-checked via the repo before insert.
 */
export async function seedPostgresNamespace(testUserId: string): Promise<void> {
  const { client, db } = createPostgresClient();
  try {
    const repo = new PostgresNamespaceRepository(db);
    const data = buildSeedData(testUserId);

    const namespaceFixture = data.namespaces[TEST_ORG_HANDLE];
    if (!namespaceFixture) {
      throw new Error(`buildSeedData has no fixture for handle "${TEST_ORG_HANDLE}"`);
    }
    const namespace = namespaceFixture as unknown as Namespace;
    const existing = await repo.getNamespace(namespace.handle);
    if (!existing) {
      await repo.createNamespace(namespace);
    }

    for (const memberFixture of Object.values(data.namespaceMembers)) {
      const member = memberFixture as unknown as NamespaceMember;
      // addMember is upsert in the Postgres repo — safe to call unconditionally.
      await repo.addMember(namespace.handle, member);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}
