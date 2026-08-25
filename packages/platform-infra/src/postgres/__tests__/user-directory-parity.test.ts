import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemberNotInNamespaceError, type UserDirectoryService } from '@mediforce/platform-core';
import { InMemoryUserDirectoryService } from '@mediforce/platform-core/testing';
import { PostgresUserDirectoryService } from '../../auth/postgres-user-directory-service';
import { authUsers } from '../schema/auth-user';
import { userRoles } from '../schema/user-role';
import { workspaces, workspaceMembers } from '../schema/workspace';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

const WS_A = 'ws-a';
const WS_B = 'ws-b';
/** A workflow one of Alice's grants is narrowed to, and one it is not. */
const TEALFLOW = 'tealflow';
const OTHERFLOW = 'otherflow';

interface SeedGrant {
  role: string;
  namespace: string;
  workflowName: string | null;
}

interface SeedUser {
  uid: string;
  email: string;
  displayName?: string | null;
  image?: string | null;
  grants: SeedGrant[];
  /** Member of both workspaces unless this says otherwise. */
  member?: boolean;
}

/**
 * Alice holds `reviewer` in both workspaces and an `approver` grant narrowed
 * to one workflow; Bob holds `reviewer` in one workspace only; Carol holds
 * nothing. That is the smallest fixture that can tell workspace scoping,
 * workflow narrowing, and "no grant at all" apart (ADR-0019).
 *
 * All three are members of both workspaces, because `setRolesForUser` refuses
 * to grant to a non-member. `DAVE` is the deliberate exception: a real user
 * who belongs to neither, so the refusal has someone to refuse.
 */
const FIXTURE: SeedUser[] = [
  {
    uid: 'u1',
    email: 'alice@x.com',
    displayName: 'Alice',
    image: 'https://img/a',
    grants: [
      { role: 'reviewer', namespace: WS_A, workflowName: null },
      { role: 'approver', namespace: WS_A, workflowName: TEALFLOW },
      { role: 'reviewer', namespace: WS_B, workflowName: null },
    ],
  },
  {
    uid: 'u2',
    email: 'bob@x.com',
    displayName: null,
    image: null,
    grants: [{ role: 'reviewer', namespace: WS_A, workflowName: null }],
  },
  { uid: 'u3', email: 'carol@x.com', grants: [] },
  { uid: 'u4', email: 'dave@x.com', grants: [], member: false },
];

const ALICE = { uid: 'u1', email: 'alice@x.com', displayName: 'Alice' };
const BOB = { uid: 'u2', email: 'bob@x.com' };

function byUid<T extends { uid: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.uid.localeCompare(b.uid));
}

const sorted = (roles: string[]): string[] => [...roles].sort();

/**
 * Shared UserDirectoryService contract (ADR-0002 PR1; workspace-scoped roles
 * per ADR-0019). Both the in-memory double and the Postgres backend MUST
 * satisfy it. `build()` returns a directory already seeded with FIXTURE.
 */
function contract(name: string, build: () => Promise<UserDirectoryService>) {
  describe(`${name} — UserDirectoryService contract`, () => {
    let dir: UserDirectoryService;

    beforeEach(async () => {
      dir = await build();
    });

    it('getUsersByRoleInNamespace returns workspace-wide holders for any workflow', async () => {
      expect(byUid(await dir.getUsersByRoleInNamespace('reviewer', WS_A, OTHERFLOW))).toEqual([
        ALICE,
        BOB,
      ]);
    });

    it('getUsersByRoleInNamespace does not leak holders across workspaces', async () => {
      // Bob is a reviewer in WS_A only. Before ADR-0019 the query was global
      // and would have returned him here.
      expect(await dir.getUsersByRoleInNamespace('reviewer', WS_B, OTHERFLOW)).toEqual([ALICE]);
    });

    it('getUsersByRoleInNamespace honours a grant narrowed to one workflow', async () => {
      expect(await dir.getUsersByRoleInNamespace('approver', WS_A, TEALFLOW)).toEqual([ALICE]);
      expect(await dir.getUsersByRoleInNamespace('approver', WS_A, OTHERFLOW)).toEqual([]);
    });

    it('getUsersByRoleInNamespace is empty for an unknown role', async () => {
      expect(await dir.getUsersByRoleInNamespace('nonexistent', WS_A, TEALFLOW)).toEqual([]);
    });

    it('getRolesForUser without a workflow returns every role held in the workspace', async () => {
      expect(sorted(await dir.getRolesForUser('u1', WS_A))).toEqual(['approver', 'reviewer']);
      expect(await dir.getRolesForUser('u1', WS_B)).toEqual(['reviewer']);
      expect(await dir.getRolesForUser('u3', WS_A)).toEqual([]);
    });

    it('getRolesForUser with a workflow drops grants narrowed to a different one', async () => {
      expect(sorted(await dir.getRolesForUser('u1', WS_A, TEALFLOW))).toEqual([
        'approver',
        'reviewer',
      ]);
      expect(await dir.getRolesForUser('u1', WS_A, OTHERFLOW)).toEqual(['reviewer']);
    });

    it('getRolesInNamespace is the workspace vocabulary, de-duplicated', async () => {
      expect(sorted(await dir.getRolesInNamespace(WS_A))).toEqual(['approver', 'reviewer']);
      expect(await dir.getRolesInNamespace(WS_B)).toEqual(['reviewer']);
    });

    it('setRolesForUser replaces the whole set in that workspace and leaves others alone', async () => {
      await dir.setRolesForUser('u1', WS_A, [
        { role: 'biostatistician', workflowName: null },
        { role: 'reviewer', workflowName: TEALFLOW },
      ]);

      expect(sorted(await dir.getRolesForUser('u1', WS_A))).toEqual([
        'biostatistician',
        'reviewer',
      ]);
      // The `approver@tealflow` grant is gone; the WS_B grant never moved.
      expect(await dir.getRolesForUser('u1', WS_A, OTHERFLOW)).toEqual(['biostatistician']);
      expect(await dir.getRolesForUser('u1', WS_B)).toEqual(['reviewer']);
    });

    it('setRolesForUser is idempotent and an empty array clears', async () => {
      const grants = [{ role: 'reviewer', workflowName: null }];
      await dir.setRolesForUser('u2', WS_A, grants);
      await dir.setRolesForUser('u2', WS_A, grants);
      expect(await dir.getRolesForUser('u2', WS_A)).toEqual(['reviewer']);

      await dir.setRolesForUser('u2', WS_A, []);
      expect(await dir.getRolesForUser('u2', WS_A)).toEqual([]);
      expect(await dir.getUsersByRoleInNamespace('reviewer', WS_A, OTHERFLOW)).toEqual([ALICE]);
    });

    it('setRolesForUser refuses a non-member, leaving the workspace untouched', async () => {
      // A grant to a non-member authorises nothing today, but survives
      // invisibly and reactivates the day they are added (ADR-0019).
      await expect(
        dir.setRolesForUser('u4', WS_A, [{ role: 'reviewer', workflowName: null }]),
      ).rejects.toBeInstanceOf(MemberNotInNamespaceError);

      expect(await dir.getRolesForUser('u4', WS_A)).toEqual([]);
      expect(byUid(await dir.getUsersByRoleInNamespace('reviewer', WS_A, OTHERFLOW))).toEqual([
        ALICE,
        BOB,
      ]);
    });

    it('setRolesForUser refuses a member of another workspace', async () => {
      // Membership is per workspace: holding it in WS_B does not make u2
      // grantable in a workspace they never joined.
      await expect(
        dir.setRolesForUser('u2', 'ws-never-joined', [{ role: 'reviewer', workflowName: null }]),
      ).rejects.toBeInstanceOf(MemberNotInNamespaceError);
    });

    it('clearRolesForWorkflow drops narrowed grants and keeps workspace-wide ones', async () => {
      await dir.clearRolesForWorkflow(WS_A, TEALFLOW);

      expect(await dir.getRolesForUser('u1', WS_A)).toEqual(['reviewer']);
      expect(await dir.getUsersByRoleInNamespace('approver', WS_A, TEALFLOW)).toEqual([]);
    });

    it('resolveUser finds by email, by uid, and returns null for missing', async () => {
      expect(await dir.resolveUser?.('alice@x.com')).toEqual(ALICE);
      expect(await dir.resolveUser?.('u2')).toEqual(BOB);
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
    if (u.member !== false) {
      dir.addMember(u.uid, WS_A);
      dir.addMember(u.uid, WS_B);
    }
    for (const grant of u.grants) {
      dir.addRole(u.uid, grant.namespace, grant.role, grant.workflowName);
    }
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

  async function resetAndSeed(): Promise<void> {
    await testClient.unsafe(
      `TRUNCATE TABLE "${schemaName}"."user_roles", "${schemaName}"."workspace_members", "${schemaName}"."auth_users", "${schemaName}"."workspaces" CASCADE`,
    );
    await db.insert(workspaces).values(
      [WS_A, WS_B].map((handle) => ({
        handle,
        type: 'organization',
        displayName: handle,
      })),
    );
    await db.insert(authUsers).values(
      FIXTURE.map((u) => ({
        id: u.uid,
        email: u.email,
        name: u.displayName ?? null,
        image: u.image ?? null,
      })),
    );
    await db.insert(workspaceMembers).values(
      FIXTURE.filter((u) => u.member !== false).flatMap((u) =>
        [WS_A, WS_B].map((workspace) => ({ workspace, uid: u.uid, role: 'member' })),
      ),
    );
    const grants = FIXTURE.flatMap((u) =>
      u.grants.map((grant) => ({
        uid: u.uid,
        role: grant.role,
        namespace: grant.namespace,
        workflowName: grant.workflowName,
      })),
    );
    if (grants.length > 0) await db.insert(userRoles).values(grants);
  }

  contract('PostgresUserDirectoryService', async () => {
    await resetAndSeed();
    return new PostgresUserDirectoryService(db);
  });

  // Postgres only: the in-memory double is serial by construction, so it can
  // never reproduce this.
  //
  // READ COMMITTED gives every statement a fresh snapshot, so two replaces
  // running at once each delete the set they saw and then insert their own,
  // and the member ends up holding the union — a role from each admin,
  // matching neither request. Firing both with `Promise.all` does not prove
  // it: the pool opens its second connection lazily, so the first replace is
  // usually done before the second one has a socket. This drives the
  // interleave instead of hoping for it — an outer transaction holds the
  // member's row exactly as an in-flight replace would, and the replace under
  // test has to queue behind it rather than run alongside.
  it('queues a full replace behind the transaction already holding that member', async () => {
    await resetAndSeed();
    const dir = new PostgresUserDirectoryService(db);

    let releaseHolder!: () => void;
    const holderReleased = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holder = testClient.begin(async (tx) => {
      await tx`SELECT 1 FROM "workspace_members" WHERE "workspace" = ${WS_A} AND "uid" = 'u3' FOR UPDATE`;
      await holderReleased;
    });

    let settled = false;
    const replace = dir
      .setRolesForUser('u3', WS_A, [{ role: 'reviewer', workflowName: null }])
      .then(() => {
        settled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 300));
    // Still waiting on the row. Without the lock it would have finished long
    // ago — which is exactly how both replaces get to insert.
    expect(settled).toBe(false);

    releaseHolder();
    await holder;
    await replace;

    expect(await dir.getRolesForUser('u3', WS_A)).toEqual(['reviewer']);
  });
});
