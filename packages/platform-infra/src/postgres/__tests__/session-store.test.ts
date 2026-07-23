import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSessionUserId,
  getUserRoles,
  createDatabaseSession,
  SESSION_TTL_MS,
} from '../../auth/session-store';
import { authUsers } from '../schema/auth-user';
import { userRoles } from '../schema/user-role';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

describe.skipIf(skipPg)('session-store', () => {
  const schemaName = `session_${randomBytes(8).toString('hex')}`;
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
      `TRUNCATE TABLE "${schemaName}"."auth_sessions", "${schemaName}"."user_roles", "${schemaName}"."auth_users" CASCADE`,
    );
  });

  async function seedUser(id: string, email: string): Promise<void> {
    await db.insert(authUsers).values({ id, email });
  }

  it('resolves a live session token to its user id', async () => {
    await seedUser('u1', 'u1@x.com');
    const token = randomUUID();
    await createDatabaseSession(db, {
      sessionToken: token,
      userId: 'u1',
      expires: new Date(Date.now() + SESSION_TTL_MS),
    });
    expect(await resolveSessionUserId(db, token)).toBe('u1');
  });

  it('returns null for an unknown token', async () => {
    expect(await resolveSessionUserId(db, randomUUID())).toBeNull();
  });

  it('returns null for the empty token without querying', async () => {
    expect(await resolveSessionUserId(db, '')).toBeNull();
  });

  it('rejects an expired session (revocation via lapse)', async () => {
    await seedUser('u2', 'u2@x.com');
    const token = randomUUID();
    await createDatabaseSession(db, {
      sessionToken: token,
      userId: 'u2',
      expires: new Date(Date.now() - 1000),
    });
    expect(await resolveSessionUserId(db, token)).toBeNull();
  });

  it('rejects a deleted session (immediate revocation)', async () => {
    await seedUser('u3', 'u3@x.com');
    const token = randomUUID();
    await createDatabaseSession(db, {
      sessionToken: token,
      userId: 'u3',
      expires: new Date(Date.now() + SESSION_TTL_MS),
    });
    await testClient.unsafe(`DELETE FROM "${schemaName}"."auth_sessions"`);
    expect(await resolveSessionUserId(db, token)).toBeNull();
  });

  it('returns the user global process roles, empty when none', async () => {
    await seedUser('u4', 'u4@x.com');
    expect(await getUserRoles(db, 'u4')).toEqual([]);
    await db.insert(userRoles).values([
      { uid: 'u4', role: 'reviewer' },
      { uid: 'u4', role: 'approver' },
    ]);
    expect((await getUserRoles(db, 'u4')).sort()).toEqual(['approver', 'reviewer']);
  });
});
