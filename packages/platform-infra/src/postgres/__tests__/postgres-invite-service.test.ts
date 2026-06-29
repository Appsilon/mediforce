import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgresInviteService } from '../../auth/postgres-invite-service';
import { authUsers } from '../schema/auth-user';
import { userRoles } from '../schema/user-role';
import { workspaces, workspaceMembers } from '../schema/workspace';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

describe.skipIf(skipPg)('PostgresInviteService', () => {
  const schemaName = `invite_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;
  let service: PostgresInviteService;

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
    service = new PostgresInviteService(db);
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
      `TRUNCATE TABLE "${schemaName}"."user_roles", "${schemaName}"."workspace_members", "${schemaName}"."auth_users", "${schemaName}"."workspaces" CASCADE`,
    );
    await db.insert(workspaces).values({ handle: 'acme', type: 'team', displayName: 'Acme' });
  });

  it('seeds the auth_users row, workspace membership, and global roles in one go', async () => {
    const { uid, isExisting } = await service.seedInvite({
      email: 'new@acme.com',
      displayName: 'New Person',
      workspaceHandle: 'acme',
      membership: 'admin',
      roles: ['reviewer', 'approver'],
    });

    expect(isExisting).toBe(false);

    const users = await db.select().from(authUsers).where(eq(authUsers.id, uid));
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: uid, email: 'new@acme.com', name: 'New Person' });

    const members = await db.select().from(workspaceMembers).where(eq(workspaceMembers.uid, uid));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ workspace: 'acme', uid, role: 'admin', displayName: 'New Person' });

    const roles = (await db.select().from(userRoles).where(eq(userRoles.uid, uid)))
      .map((r) => r.role)
      .sort();
    expect(roles).toEqual(['approver', 'reviewer']);
  });

  it('seeds no roles when none are given', async () => {
    const { uid } = await service.seedInvite({
      email: 'norole@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
    });
    expect(await db.select().from(userRoles).where(eq(userRoles.uid, uid))).toEqual([]);
  });

  it('is idempotent on email collision — reuses uid, no duplicate membership/roles', async () => {
    const first = await service.seedInvite({
      email: 'dup@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      roles: ['reviewer'],
    });
    const second = await service.seedInvite({
      email: 'dup@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      roles: ['reviewer'],
    });

    expect(second.isExisting).toBe(true);
    expect(second.uid).toBe(first.uid);
    expect(await db.select().from(authUsers).where(eq(authUsers.email, 'dup@acme.com'))).toHaveLength(1);
    expect(await db.select().from(workspaceMembers).where(eq(workspaceMembers.uid, first.uid))).toHaveLength(1);
    expect(await db.select().from(userRoles).where(eq(userRoles.uid, first.uid))).toHaveLength(1);
  });

  it('getUserEmail returns the seeded email and null for unknown uids', async () => {
    const { uid } = await service.seedInvite({
      email: 'lookup@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
    });
    expect(await service.getUserEmail(uid)).toBe('lookup@acme.com');
    expect(await service.getUserEmail('nope')).toBeNull();
  });
});
