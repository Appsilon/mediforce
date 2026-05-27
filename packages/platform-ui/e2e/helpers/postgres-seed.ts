import postgres from 'postgres';
import { TEST_ORG_HANDLE } from './constants';
import { buildSeedData } from './seed-data';

/**
 * Postgres mirror of the Firestore `namespaces` + `namespaces/{handle}/members`
 * seeds written in `auth-setup.ts`. Invoked only when `STORAGE_BACKEND=postgres`
 * so the regular emulator-only `e2e-tests` job is unaffected (ADR-0001 PR2).
 *
 * Uses raw `postgres-js` rather than the `@mediforce/platform-infra` package
 * because Playwright workers don't resolve the `@mediforce/source` package
 * exports condition the way `tsx` does at type-check time — importing the
 * compiled `dist` fails because we don't build it in CI. The fixture is tiny
 * (one row + one row) so the SQL fits inline.
 *
 * Reuses `buildSeedData` so the fixture stays byte-identical to the
 * Firestore-side seed — no drift between backends.
 *
 * Idempotent: ON CONFLICT DO NOTHING for the workspace, ON CONFLICT DO UPDATE
 * for the member (matches the Postgres NamespaceRepository.addMember
 * semantic).
 */
export async function seedPostgresNamespace(testUserId: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set to seed Postgres for E2E.');
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const data = buildSeedData(testUserId);
    const namespace = data.namespaces[TEST_ORG_HANDLE];
    if (!namespace) {
      throw new Error(`buildSeedData has no fixture for handle "${TEST_ORG_HANDLE}"`);
    }

    await sql`
      INSERT INTO workspaces (handle, type, display_name, linked_user_id, created_at)
      VALUES (
        ${namespace.handle as string},
        ${namespace.type as string},
        ${namespace.displayName as string},
        ${(namespace.linkedUserId as string | undefined) ?? null},
        ${namespace.createdAt as string}
      )
      ON CONFLICT (handle) DO NOTHING
    `;

    for (const member of Object.values(data.namespaceMembers)) {
      await sql`
        INSERT INTO workspace_members (workspace, uid, role, joined_at)
        VALUES (
          ${TEST_ORG_HANDLE},
          ${member.uid as string},
          ${member.role as string},
          ${member.joinedAt as string}
        )
        ON CONFLICT (workspace, uid) DO UPDATE SET
          role = EXCLUDED.role,
          joined_at = EXCLUDED.joined_at
      `;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
