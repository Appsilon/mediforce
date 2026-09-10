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
import { authAccounts } from '../schema/auth-account';
import { authSessions } from '../schema/auth-session';
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
      vouchedByAdmin: true,
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

  /**
   * `invited_at` (migration 0048) is the second term of the ADR-0021 §5 sign-in
   * gate, and `seedInvite` is its only writer. These three cases are the whole
   * contract: an admin's add stamps it, a re-add repairs a row that predates the
   * column without rewriting history, and nothing else can set it — which is
   * what leaves `ALLOWED_EMAIL_DOMAINS` able to evict a self-registered account.
   */
  it('stamps invited_at on a freshly seeded account', async () => {
    const before = new Date();
    const { uid } = await service.seedInvite({
      email: 'stamped@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });

    const [user] = await db.select().from(authUsers).where(eq(authUsers.id, uid));
    expect(user?.invitedAt).not.toBeNull();
    expect(user!.invitedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('stamps invited_at on an account that already existed but was never invited', async () => {
    // The shape the Auth.js adapter leaves behind for a self-registered user,
    // and the shape every row had the moment migration 0048 ran.
    await db.insert(authUsers).values({ id: 'self-registered', email: 'self@acme.com' });

    await service.seedInvite({
      email: 'self@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });

    const [user] = await db.select().from(authUsers).where(eq(authUsers.id, 'self-registered'));
    expect(user?.invitedAt).not.toBeNull();
  });

  it('keeps the first invited_at across a re-invite', async () => {
    const { uid } = await service.seedInvite({
      email: 'reinvited@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });
    const [first] = await db.select().from(authUsers).where(eq(authUsers.id, uid));

    await service.seedInvite({
      email: 'reinvited@acme.com',
      workspaceHandle: 'acme',
      membership: 'admin',
      vouchedByAdmin: true,
    });

    const [second] = await db.select().from(authUsers).where(eq(authUsers.id, uid));
    // It records when they were first vouched for; a later re-invite must not
    // rewrite that.
    expect(second?.invitedAt?.getTime()).toBe(first?.invitedAt?.getTime());
  });

  /**
   * `vouchedByAdmin: false` is the join-link redemption path (ADR-0021 §4),
   * where the email is typed into a public form by whoever holds a shared
   * secret. These four cases are what stops that from being an escalation: a
   * redemption may CREATE, and may not touch anything that already exists.
   *
   * Each was a live defect before the flag existed, reproduced here so it
   * cannot come back.
   */
  describe('an unauthenticated redemption may only create', () => {
    it('does not demote an existing owner to the link\u2019s membership', async () => {
      const { uid } = await service.seedInvite({
        email: 'owner@acme.com',
        workspaceHandle: 'acme',
        membership: 'owner',
        vouchedByAdmin: true,
      });

      // A `member` join link, redeemed against the owner's address.
      await service.seedInvite({
        email: 'owner@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: false,
      });

      const [member] = await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.uid, uid));
      expect(member?.role).toBe('owner');
    });

    it('does not promote an existing member to the link\u2019s membership', async () => {
      const { uid } = await service.seedInvite({
        email: 'plain@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: true,
      });

      await service.seedInvite({
        email: 'plain@acme.com',
        workspaceHandle: 'acme',
        membership: 'admin',
        vouchedByAdmin: false,
      });

      const [member] = await db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.uid, uid));
      expect(member?.role).toBe('member');
    });

    it('does not stamp invited_at on an account the allowlist blocks', async () => {
      // The shape the Auth.js adapter leaves for a self-registered user, and
      // the one migration 0048's comment names by address: stamping it would
      // exempt the account from `ALLOWED_EMAIL_DOMAINS` permanently.
      await db.insert(authUsers).values({ id: 'blocked-user', email: 'fylyps@gmail.com' });

      await service.seedInvite({
        email: 'fylyps@gmail.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: false,
      });

      const [user] = await db.select().from(authUsers).where(eq(authUsers.id, 'blocked-user'));
      expect(user?.invitedAt).toBeNull();
    });

    it('still stamps invited_at for a brand-new address', async () => {
      // Nobody held this address, so there is no standing to subvert — and the
      // link was minted by an admin, which is the vouching §5 asks for.
      const { uid } = await service.seedInvite({
        email: 'walkin@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: false,
      });

      const [user] = await db.select().from(authUsers).where(eq(authUsers.id, uid));
      expect(user?.invitedAt).not.toBeNull();
    });
  });

  it('seeds no roles when none are given', async () => {
    const { uid } = await service.seedInvite({
      email: 'norole@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });
    expect(await db.select().from(userRoles).where(eq(userRoles.uid, uid))).toEqual([]);
  });

  it('is idempotent on email collision — reuses uid, no duplicate membership/roles', async () => {
    const first = await service.seedInvite({
      email: 'dup@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      roles: ['reviewer'],
      vouchedByAdmin: true,
    });
    const second = await service.seedInvite({
      email: 'dup@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      roles: ['reviewer'],
      vouchedByAdmin: true,
    });

    expect(second.isExisting).toBe(true);
    expect(second.uid).toBe(first.uid);
    expect(await db.select().from(authUsers).where(eq(authUsers.email, 'dup@acme.com'))).toHaveLength(1);
    expect(await db.select().from(workspaceMembers).where(eq(workspaceMembers.uid, first.uid))).toHaveLength(1);
    expect(await db.select().from(userRoles).where(eq(userRoles.uid, first.uid))).toHaveLength(1);
  });

  it('treats addresses differing only in case as one account', async () => {
    // Google hands back a lower-cased address, so a mixed-case invite has to
    // land on the same row or the invitee gets a second, empty identity.
    const first = await service.seedInvite({
      email: 'Mixed.Case@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });
    const second = await service.seedInvite({
      email: 'mixed.case@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });

    expect(second.uid).toBe(first.uid);
    expect(second.isExisting).toBe(true);
    const stored = await db.select().from(authUsers).where(eq(authUsers.id, first.uid));
    expect(stored[0]?.email).toBe('mixed.case@acme.com');
  });

  it('re-inviting with a different membership updates the existing role', async () => {
    const first = await service.seedInvite({
      email: 'promoted@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });

    const second = await service.seedInvite({
      email: 'promoted@acme.com',
      workspaceHandle: 'acme',
      membership: 'admin',
      vouchedByAdmin: true,
    });

    expect(second.uid).toBe(first.uid);
    expect(second.isExisting).toBe(true);

    const members = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.uid, first.uid));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ workspace: 'acme', role: 'admin' });
  });

  it('getUserEmail returns the seeded email and null for unknown uids', async () => {
    const { uid } = await service.seedInvite({
      email: 'lookup@acme.com',
      workspaceHandle: 'acme',
      membership: 'member',
      vouchedByAdmin: true,
    });
    expect(await service.getUserEmail(uid)).toBe('lookup@acme.com');
    expect(await service.getUserEmail('nope')).toBeNull();
  });

  describe('isInvitePending', () => {
    it('is pending for a freshly seeded user (no session, no oauth, no password)', async () => {
      const { uid } = await service.seedInvite({
        email: 'fresh@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: true,
      });
      expect(await service.isInvitePending(uid)).toBe(true);
    });

    it('is NOT pending for an OAuth-only user (linked auth_accounts row, no password)', async () => {
      const { uid } = await service.seedInvite({
        email: 'google@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: true,
      });
      await db.insert(authAccounts).values({
        userId: uid,
        type: 'oidc',
        provider: 'google',
        providerAccountId: 'google-sub-123',
      });
      expect(await service.isInvitePending(uid)).toBe(false);
    });

    it('is NOT pending for a user with an active session', async () => {
      const { uid } = await service.seedInvite({
        email: 'session@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: true,
      });
      await db.insert(authSessions).values({
        sessionToken: 'tok-abc',
        userId: uid,
        expires: new Date(Date.now() + 60_000),
      });
      expect(await service.isInvitePending(uid)).toBe(false);
    });

    it('is NOT pending for a user who set a password', async () => {
      const { uid } = await service.seedInvite({
        email: 'pwd@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: true,
      });
      await db
        .update(authUsers)
        .set({ passwordHash: 'bcrypt-hash' })
        .where(eq(authUsers.id, uid));
      expect(await service.isInvitePending(uid)).toBe(false);
    });

    it('is NOT pending for a user with BOTH a password hash and an oauth account', async () => {
      const { uid } = await service.seedInvite({
        email: 'both@acme.com',
        workspaceHandle: 'acme',
        membership: 'member',
        vouchedByAdmin: true,
      });
      await db.insert(authAccounts).values({
        userId: uid,
        type: 'oidc',
        provider: 'google',
        providerAccountId: 'google-sub-both',
      });
      await db
        .update(authUsers)
        .set({ passwordHash: 'bcrypt-hash' })
        .where(eq(authUsers.id, uid));
      expect(await service.isInvitePending(uid)).toBe(false);
    });

    it('is NOT pending for an unknown uid', async () => {
      expect(await service.isInvitePending('does-not-exist')).toBe(false);
    });
  });
});
