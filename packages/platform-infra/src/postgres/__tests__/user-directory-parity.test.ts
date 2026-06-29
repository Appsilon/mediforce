import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Auth } from 'firebase-admin/auth';
import type { UserDirectoryService } from '@mediforce/platform-core';
import { InMemoryUserDirectoryService } from '@mediforce/platform-core/testing';
import { PostgresUserDirectoryService } from '../../auth/postgres-user-directory-service';
import { FirebaseUserDirectoryService } from '../../auth/firebase-user-directory-service';
import { buildUserRolesSeed, type FirebaseUserExport } from '../../auth/seed-user-roles';
import { authUsers } from '../schema/auth-user';
import { userRoles } from '../schema/user-role';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

interface SeedUser {
  uid: string;
  email: string;
  displayName?: string | null;
  image?: string | null;
  roles: string[];
}

const FIXTURE: SeedUser[] = [
  { uid: 'u1', email: 'alice@x.com', displayName: 'Alice', image: 'https://img/a', roles: ['reviewer', 'approver'] },
  { uid: 'u2', email: 'bob@x.com', displayName: null, image: null, roles: ['reviewer'] },
  { uid: 'u3', email: 'carol@x.com', roles: [] },
];

function byUid<T extends { uid: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.uid.localeCompare(b.uid));
}

/**
 * Shared UserDirectoryService contract (ADR-0002 PR1). Both the in-memory
 * double and the Postgres backend MUST satisfy it. `build()` returns a
 * directory already seeded with FIXTURE.
 */
function contract(name: string, build: () => Promise<UserDirectoryService>) {
  describe(`${name} — UserDirectoryService contract`, () => {
    let dir: UserDirectoryService;

    beforeEach(async () => {
      dir = await build();
    });

    it('getUsersByRole returns exactly the seeded users for a role', async () => {
      expect(byUid(await dir.getUsersByRole('reviewer'))).toEqual([
        { uid: 'u1', email: 'alice@x.com', displayName: 'Alice' },
        { uid: 'u2', email: 'bob@x.com' },
      ]);
    });

    it('getUsersByRole returns a single user for a role only one user holds', async () => {
      expect(await dir.getUsersByRole('approver')).toEqual([
        { uid: 'u1', email: 'alice@x.com', displayName: 'Alice' },
      ]);
    });

    it('getUsersByRole is empty for an unknown role', async () => {
      expect(await dir.getUsersByRole('nonexistent')).toEqual([]);
    });

    it('resolveUser finds by email, by uid, and returns null for missing', async () => {
      expect(await dir.resolveUser?.('alice@x.com')).toEqual({
        uid: 'u1',
        email: 'alice@x.com',
        displayName: 'Alice',
      });
      expect(await dir.resolveUser?.('u2')).toEqual({ uid: 'u2', email: 'bob@x.com' });
      expect(await dir.resolveUser?.('missing@x.com')).toBeNull();
    });

    it('getUserMetadata maps fields, with lastSignInTime null and photoURL from image', async () => {
      expect(await dir.getUserMetadata('u1')).toEqual({
        email: 'alice@x.com',
        displayName: 'Alice',
        lastSignInTime: null,
        photoURL: 'https://img/a',
      });
      expect(await dir.getUserMetadata('u2')).toEqual({
        email: 'bob@x.com',
        displayName: null,
        lastSignInTime: null,
        photoURL: null,
      });
    });

    it('getUserMetadata is null for an unknown uid', async () => {
      expect(await dir.getUserMetadata('missing')).toBeNull();
    });
  });
}

contract('InMemoryUserDirectoryService', async () => {
  const dir = new InMemoryUserDirectoryService();
  for (const u of FIXTURE) {
    dir.addUser({ uid: u.uid, email: u.email, displayName: u.displayName, image: u.image });
    for (const role of u.roles) dir.addRole(u.uid, role);
  }
  return dir;
});

describe.skipIf(skipPg)('PostgresUserDirectoryService (parity)', () => {
  const schemaName = `userdir_${randomBytes(8).toString('hex')}`;
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

  async function resetAndSeed(rows: { authUsers: { id: string; email: string; name: string | null; image: string | null }[]; userRoles: { uid: string; role: string }[] }) {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."user_roles", "${schemaName}"."auth_users" CASCADE`);
    if (rows.authUsers.length > 0) await db.insert(authUsers).values(rows.authUsers);
    if (rows.userRoles.length > 0) await db.insert(userRoles).values(rows.userRoles);
  }

  contract('PostgresUserDirectoryService', async () => {
    await resetAndSeed({
      authUsers: FIXTURE.map((u) => ({
        id: u.uid,
        email: u.email,
        name: u.displayName ?? null,
        image: u.image ?? null,
      })),
      userRoles: FIXTURE.flatMap((u) => u.roles.map((role) => ({ uid: u.uid, role }))),
    });
    return new PostgresUserDirectoryService(db);
  });

  // Non-breaking guard: the Postgres directory, seeded from a Firebase export
  // via `buildUserRolesSeed`, returns the SAME getUsersByRole set as the
  // Firebase directory did — no silent change to escalation targeting.
  it('getUsersByRole matches FirebaseUserDirectoryService on the same export', async () => {
    const exported: FirebaseUserExport[] = [
      { uid: 'f1', email: 'f1@x.com', displayName: 'F One', customClaims: { roles: ['reviewer', 'approver'], role: 'admin' } },
      { uid: 'f2', email: 'f2@x.com', customClaims: { roles: ['reviewer'] } },
      { uid: 'f3', email: 'f3@x.com', customClaims: { role: 'auditor' } },
      { uid: 'f4', email: 'f4@x.com', customClaims: null },
    ];
    await resetAndSeed(buildUserRolesSeed(exported));
    const pg = new PostgresUserDirectoryService(db);
    const firebase = new FirebaseUserDirectoryService(fakeAuth(exported));

    for (const role of ['reviewer', 'approver', 'auditor', 'admin', 'nope']) {
      const pgUids = (await pg.getUsersByRole(role)).map((u) => u.uid).sort();
      const fbUids = (await firebase.getUsersByRole(role)).map((u) => u.uid).sort();
      expect(pgUids).toEqual(fbUids);
    }
  });
});

function fakeAuth(users: FirebaseUserExport[]): Auth {
  return {
    listUsers: async () => ({ users, pageToken: undefined }),
  } as unknown as Auth;
}
