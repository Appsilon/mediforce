import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UserProfileRepository } from '@mediforce/platform-core';
import { InMemoryUserProfileRepository } from '@mediforce/platform-core/testing';
import { PostgresUserProfileRepository } from '../repositories/user-profile-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

/**
 * Shared contract for UserProfileRepository (ADR-0001 final cutover, #534).
 * Both the in-memory double and the Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<UserProfileRepository>) {
  describe(`${name} — UserProfileRepository contract`, () => {
    let repo: UserProfileRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('returns null for an absent uid', async () => {
      expect(await repo.getProfile('uid-missing')).toBeNull();
    });

    it('setMustChangePassword creates the row and getProfile reflects it', async () => {
      await repo.setMustChangePassword('uid-1', true);
      expect(await repo.getProfile('uid-1')).toEqual({ mustChangePassword: true });
    });

    it('setMustChangePassword upserts an existing row without duplicating', async () => {
      await repo.setMustChangePassword('uid-2', true);
      await repo.setMustChangePassword('uid-2', false);
      expect(await repo.getProfile('uid-2')).toEqual({ mustChangePassword: false });
    });

    it('isolates profiles by uid', async () => {
      await repo.setMustChangePassword('uid-a', true);
      await repo.setMustChangePassword('uid-b', false);
      expect(await repo.getProfile('uid-a')).toEqual({ mustChangePassword: true });
      expect(await repo.getProfile('uid-b')).toEqual({ mustChangePassword: false });
    });
  });
}

contract(
  'InMemoryUserProfileRepository',
  async () => new InMemoryUserProfileRepository(),
);

describe.skipIf(skipPg)('PostgresUserProfileRepository (parity)', () => {
  const schemaName = `userprofile_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;

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
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await testClient.unsafe(sql);
    }
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  contract('PostgresUserProfileRepository', async () => {
    const db = drizzle(testClient, { schema });
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."user_profiles"`);
    return new PostgresUserProfileRepository(db);
  });
});
