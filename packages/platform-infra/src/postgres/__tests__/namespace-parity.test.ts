import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Namespace, NamespaceMember, NamespaceRepository } from '@mediforce/platform-core';
import { InMemoryNamespaceRepository } from '@mediforce/platform-core/testing';
import { PostgresNamespaceRepository } from '../repositories/namespace-repository';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

function nsBase(overrides: Partial<Namespace> = {}): Namespace {
  return {
    handle: 'appsilon',
    type: 'organization',
    displayName: 'Appsilon',
    createdAt: '2026-05-27T12:00:00.000Z',
    ...overrides,
  };
}

function memberBase(overrides: Partial<NamespaceMember> = {}): NamespaceMember {
  return {
    uid: 'user-1',
    role: 'member',
    joinedAt: '2026-05-27T12:00:00.000Z',
    ...overrides,
  };
}

/**
 * Shared contract for NamespaceRepository (ADR-0001 L2 parity).
 * Both the in-memory double and Postgres backend MUST satisfy it.
 */
function contract(name: string, factory: () => Promise<NamespaceRepository>) {
  describe(`${name} — NamespaceRepository contract`, () => {
    let repo: NamespaceRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    it('returns null for getNamespace when absent', async () => {
      expect(await repo.getNamespace('missing')).toBeNull();
    });

    it('createNamespace + getNamespace round-trips minimum fields', async () => {
      await repo.createNamespace(nsBase());
      expect(await repo.getNamespace('appsilon')).toEqual(nsBase());
    });

    it('createNamespace + getNamespace round-trips all optional fields', async () => {
      const full = nsBase({
        handle: 'fullns',
        type: 'personal',
        displayName: 'Full NS',
        avatarUrl: 'https://example.com/a.png',
        icon: 'rocket',
        linkedUserId: 'user-99',
        bio: 'A whole namespace.',
      });
      await repo.createNamespace(full);
      expect(await repo.getNamespace('fullns')).toEqual(full);
    });

    it('updateNamespace patches a subset of fields and preserves the rest', async () => {
      const original = nsBase({
        displayName: 'Original',
        bio: 'Keep me',
        icon: 'keep-icon',
      });
      await repo.createNamespace(original);
      await repo.updateNamespace('appsilon', { displayName: 'Updated' });
      const got = await repo.getNamespace('appsilon');
      expect(got).toEqual({ ...original, displayName: 'Updated' });
    });

    it('addMember + getMember round-trips with optional fields', async () => {
      await repo.createNamespace(nsBase());
      const member = memberBase({
        uid: 'user-1',
        role: 'admin',
        displayName: 'Alice',
        avatarUrl: 'https://example.com/alice.png',
      });
      await repo.addMember('appsilon', member);
      expect(await repo.getMember('appsilon', 'user-1')).toEqual(member);
    });

    it('addMember of existing uid overwrites the role', async () => {
      await repo.createNamespace(nsBase());
      await repo.addMember('appsilon', memberBase({ uid: 'user-1', role: 'member' }));
      await repo.addMember('appsilon', memberBase({ uid: 'user-1', role: 'owner' }));
      const got = await repo.getMember('appsilon', 'user-1');
      expect(got?.role).toBe('owner');
    });

    it('removeMember deletes, no-op when missing', async () => {
      await repo.createNamespace(nsBase());
      await repo.addMember('appsilon', memberBase({ uid: 'user-1' }));
      await repo.removeMember('appsilon', 'user-1');
      expect(await repo.getMember('appsilon', 'user-1')).toBeNull();
      await expect(repo.removeMember('appsilon', 'user-1')).resolves.toBeUndefined();
    });

    it('removeMemberWithOrganizations deletes the member row', async () => {
      await repo.createNamespace(nsBase());
      await repo.addMember('appsilon', memberBase({ uid: 'user-1' }));
      await repo.removeMemberWithOrganizations('appsilon', 'user-1');
      expect(await repo.getMember('appsilon', 'user-1')).toBeNull();
      await expect(repo.removeMemberWithOrganizations('appsilon', 'user-1')).resolves.toBeUndefined();
    });

    it('setMemberRole updates an existing member; no-op when absent', async () => {
      await repo.createNamespace(nsBase());
      await repo.addMember('appsilon', memberBase({ uid: 'user-1', role: 'member' }));
      await repo.setMemberRole('appsilon', 'user-1', 'admin');
      expect((await repo.getMember('appsilon', 'user-1'))?.role).toBe('admin');
      await expect(repo.setMemberRole('appsilon', 'ghost', 'owner')).resolves.toBeUndefined();
      expect(await repo.getMember('appsilon', 'ghost')).toBeNull();
    });

    it('deleteNamespaceCascade removes the namespace and all members', async () => {
      await repo.createNamespace(nsBase());
      await repo.createNamespace(nsBase({ handle: 'survivor', displayName: 'Survivor' }));
      await repo.addMember('appsilon', memberBase({ uid: 'user-1' }));
      await repo.addMember('appsilon', memberBase({ uid: 'user-2' }));
      await repo.addMember('survivor', memberBase({ uid: 'user-3' }));

      await repo.deleteNamespaceCascade('appsilon');
      expect(await repo.getNamespace('appsilon')).toBeNull();
      expect(await repo.getMembers('appsilon')).toEqual([]);
      // Sibling namespace + its members untouched.
      expect(await repo.getNamespace('survivor')).not.toBeNull();
      expect((await repo.getMembers('survivor')).map((m) => m.uid)).toEqual(['user-3']);
    });

    it('getMembers returns all members in a namespace and nothing from siblings', async () => {
      await repo.createNamespace(nsBase());
      await repo.createNamespace(nsBase({ handle: 'other-ws', displayName: 'Other' }));
      await repo.addMember('appsilon', memberBase({ uid: 'user-1' }));
      await repo.addMember('appsilon', memberBase({ uid: 'user-2' }));
      await repo.addMember('other-ws', memberBase({ uid: 'user-3' }));

      const members = await repo.getMembers('appsilon');
      expect(members).toHaveLength(2);
      expect(members.map((m) => m.uid).sort()).toEqual(['user-1', 'user-2']);

      const otherMembers = await repo.getMembers('other-ws');
      expect(otherMembers.map((m) => m.uid)).toEqual(['user-3']);
    });

    it('getUserNamespaces returns only organizations the user is a member of (not personal)', async () => {
      await repo.createNamespace(
        nsBase({
          handle: 'personal-ns',
          type: 'personal',
          linkedUserId: 'user-1',
        }),
      );
      await repo.createNamespace(nsBase({ handle: 'org-a', displayName: 'Org A' }));
      await repo.createNamespace(nsBase({ handle: 'org-b', displayName: 'Org B' }));
      await repo.addMember('org-a', memberBase({ uid: 'user-1' }));
      await repo.addMember('org-b', memberBase({ uid: 'user-2' }));

      const orgs = await repo.getUserNamespaces('user-1');
      expect(orgs.map((n) => n.handle).sort()).toEqual(['org-a']);
    });

    it('getNamespacesByUser returns personal UNION organizations, deduplicated', async () => {
      await repo.createNamespace(
        nsBase({
          handle: 'personal-ns',
          type: 'personal',
          linkedUserId: 'user-1',
        }),
      );
      await repo.createNamespace(nsBase({ handle: 'org-a', displayName: 'Org A' }));
      await repo.createNamespace(
        nsBase({
          handle: 'org-b',
          displayName: 'Org B',
          linkedUserId: 'user-1', // intentionally also linked — dedup should kick in
        }),
      );
      await repo.addMember('org-a', memberBase({ uid: 'user-1' }));
      await repo.addMember('org-b', memberBase({ uid: 'user-1' }));

      const all = await repo.getNamespacesByUser('user-1');
      const handles = all.map((n) => n.handle).sort();
      expect(handles).toEqual(['org-a', 'org-b', 'personal-ns']);
    });

    it('rejects createNamespace with invalid payload', async () => {
      await expect(
        repo.createNamespace({
          ...nsBase(),
          type: 'bogus',
        } as unknown as Namespace),
      ).rejects.toThrow();
    });
  });
}

contract('InMemoryNamespaceRepository', async () => new InMemoryNamespaceRepository());

describe.skipIf(skipPg)('PostgresNamespaceRepository (parity)', () => {
  const schemaName = `ns_${randomBytes(8).toString('hex')}`;
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
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
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

  contract('PostgresNamespaceRepository', async () => {
    const db = drizzle(testClient, { schema });
    // Order matters: members first (FK → workspaces.handle ON DELETE CASCADE
    // means TRUNCATE workspaces would also wipe members, but explicit is clearer).
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`);
    return new PostgresNamespaceRepository(db);
  });

  // Postgres-specific: assert the set_updated_at trigger fires on UPDATE of
  // workspaces. The contract above can't verify this (no `updated_at` is
  // exposed through the repo interface). Without this guard, a follow-up PR
  // that drops the trigger from its migration goes unnoticed.
  it('set_updated_at trigger advances updated_at on UPDATE of workspaces', async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."workspace_members", "${schemaName}"."workspaces" CASCADE`);
    const db = drizzle(testClient, { schema });
    const repo = new PostgresNamespaceRepository(db);
    await repo.createNamespace(nsBase({ handle: 'trig' }));
    const [before] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM workspaces WHERE handle = 'trig'
    `;
    await new Promise((r) => setTimeout(r, 10));
    await repo.updateNamespace('trig', { displayName: 'Renamed' });
    const [after] = await testClient<{ updated_at: string }[]>`
      SELECT updated_at::text FROM workspaces WHERE handle = 'trig'
    `;
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
  });
});
