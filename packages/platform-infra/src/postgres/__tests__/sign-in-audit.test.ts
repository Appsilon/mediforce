import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSignInAuditEvent } from '../../auth/sign-in-audit';
import { authUsers } from '../schema/auth-user';
import { workspaces, workspaceMembers } from '../schema/workspace';
import { auditEvents } from '../schema/audit-event';
import { eq } from 'drizzle-orm';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

describe.skipIf(skipPg)('recordSignInAuditEvent', () => {
  const schemaName = `signin_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    testClient = postgres(DATABASE_URL!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await testClient.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    db = drizzle(testClient, { schema });
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  beforeEach(async () => {
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."audit_events", "${schemaName}"."workspace_members", "${schemaName}"."workspaces", "${schemaName}"."auth_users" CASCADE`,
    );
  });

  async function seedUser(id: string, email: string): Promise<void> {
    await db.insert(authUsers).values({ id, email });
  }

  async function seedWorkspace(handle: string, displayName: string): Promise<void> {
    await db.insert(workspaces).values({ handle, type: 'org', displayName });
  }

  it('writes one event per namespace the user belongs to', async () => {
    await seedUser('u1', 'u1@x.com');
    await seedWorkspace('team-alpha', 'Alpha');
    await seedWorkspace('team-beta', 'Beta');
    await db.insert(workspaceMembers).values([
      { workspace: 'team-alpha', uid: 'u1', role: 'member' },
      { workspace: 'team-beta', uid: 'u1', role: 'owner' },
    ]);

    await recordSignInAuditEvent(db, {
      uid: 'u1',
      method: { kind: 'password', ipAddress: '203.0.113.5', userAgent: 'Mozilla/5.0' },
    });

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.actorId, 'u1'));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.workspace).sort()).toEqual(['team-alpha', 'team-beta']);
    for (const row of rows) {
      expect(row.action).toBe('user.signed_in');
      expect(row.payload.inputSnapshot).toEqual({
        method: 'password',
        ipAddress: '203.0.113.5',
        userAgent: 'Mozilla/5.0',
      });
    }
    // actorRole reflects the user's real role in each namespace, not a constant.
    expect(rows.find((r) => r.workspace === 'team-beta')?.actorRole).toBe('owner');
    expect(rows.find((r) => r.workspace === 'team-alpha')?.actorRole).toBe('member');
  });

  it('records the OAuth provider instead of IP/user-agent for SSO sign-in', async () => {
    await seedUser('u2', 'u2@x.com');
    await seedWorkspace('team-alpha', 'Alpha');
    await db.insert(workspaceMembers).values({ workspace: 'team-alpha', uid: 'u2', role: 'member' });

    await recordSignInAuditEvent(db, {
      uid: 'u2',
      method: { kind: 'oauth', provider: 'google' },
    });

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.actorId, 'u2'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.inputSnapshot).toEqual({ method: 'oauth', provider: 'google' });
    expect(rows[0]?.payload.description).toContain('google');
  });

  it('writes nothing for a user with no namespace memberships', async () => {
    await seedUser('u3', 'u3@x.com');

    await recordSignInAuditEvent(db, {
      uid: 'u3',
      method: { kind: 'password', ipAddress: null, userAgent: null },
    });

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.actorId, 'u3'));
    expect(rows).toEqual([]);
  });
});
