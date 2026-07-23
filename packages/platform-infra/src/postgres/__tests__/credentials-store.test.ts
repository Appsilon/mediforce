import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUserPasswordHash } from '../../auth/credentials-store';
import { authUsers } from '../schema/auth-user';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

describe.skipIf(skipPg)('setUserPasswordHash', () => {
  const schemaName = `creds_${randomBytes(8).toString('hex')}`;
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
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."auth_users" CASCADE`);
  });

  it('sets the password hash on an existing user and returns true', async () => {
    await db.insert(authUsers).values({ id: 'u1', email: 'u1@x.com' });
    const ok = await setUserPasswordHash(db, 'u1', 'hashed-value');
    expect(ok).toBe(true);
    const rows = await db.select().from(authUsers).where(eq(authUsers.id, 'u1'));
    expect(rows[0]?.passwordHash).toBe('hashed-value');
  });

  it('returns false for an unknown user and writes nothing', async () => {
    expect(await setUserPasswordHash(db, 'ghost', 'x')).toBe(false);
  });

  it('replaces an existing hash', async () => {
    await db.insert(authUsers).values({ id: 'u2', email: 'u2@x.com', passwordHash: 'old' });
    await setUserPasswordHash(db, 'u2', 'new');
    const rows = await db.select().from(authUsers).where(eq(authUsers.id, 'u2'));
    expect(rows[0]?.passwordHash).toBe('new');
  });
});
