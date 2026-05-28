import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Namespace,
  NamespaceMember,
  NamespaceMembership,
  NamespaceRepository,
  UserDirectoryService,
} from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { getMe } from '../get-me.js';
import { ForbiddenError, ValidationError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

class InMemoryNamespaceRepository implements NamespaceRepository {
  readonly namespaces = new Map<string, Namespace>();
  readonly members = new Map<string, NamespaceMember[]>();
  readonly userOrganizations = new Map<string, string[]>();

  setNamespace(namespace: Namespace): void {
    this.namespaces.set(namespace.handle, namespace);
  }

  setMembership(handle: string, member: NamespaceMember): void {
    const existing = this.members.get(handle) ?? [];
    this.members.set(handle, [...existing.filter((m) => m.uid !== member.uid), member]);
    const orgs = this.userOrganizations.get(member.uid) ?? [];
    if (!orgs.includes(handle)) {
      this.userOrganizations.set(member.uid, [...orgs, handle]);
    }
  }

  async getNamespace(handle: string): Promise<Namespace | null> {
    return this.namespaces.get(handle) ?? null;
  }
  async createNamespace(namespace: Namespace): Promise<void> {
    this.namespaces.set(namespace.handle, namespace);
  }
  async createNamespaceWithOwner(input: {
    namespace: Namespace;
    ownerMember: NamespaceMember;
  }): Promise<void> {
    this.namespaces.set(input.namespace.handle, input.namespace);
    this.setMembership(input.namespace.handle, input.ownerMember);
  }
  async updateNamespace(handle: string, updates: Partial<Namespace>): Promise<void> {
    const existing = this.namespaces.get(handle);
    if (existing === undefined) return;
    this.namespaces.set(handle, { ...existing, ...updates });
  }
  async getNamespacesByUser(uid: string): Promise<Namespace[]> {
    const out: Namespace[] = [];
    const seen = new Set<string>();
    for (const ns of this.namespaces.values()) {
      if (ns.type === 'personal' && ns.linkedUserId === uid) {
        out.push(ns);
        seen.add(ns.handle);
      }
    }
    for (const handle of this.userOrganizations.get(uid) ?? []) {
      if (seen.has(handle)) continue;
      const ns = this.namespaces.get(handle);
      if (ns !== undefined) out.push(ns);
    }
    return out;
  }
  async addMember(handle: string, member: NamespaceMember): Promise<void> {
    this.setMembership(handle, member);
  }
  async removeMember(handle: string, uid: string): Promise<void> {
    const list = this.members.get(handle) ?? [];
    this.members.set(handle, list.filter((m) => m.uid !== uid));
  }
  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    return this.members.get(handle)?.find((m) => m.uid === uid) ?? null;
  }
  async getMembers(handle: string): Promise<NamespaceMember[]> {
    return this.members.get(handle) ?? [];
  }
  async getUserNamespaces(uid: string): Promise<Namespace[]> {
    return this.getNamespacesByUser(uid);
  }
  async getMembershipsForUser(uid: string): Promise<readonly NamespaceMembership[]> {
    const out: NamespaceMembership[] = [];
    for (const ns of this.namespaces.values()) {
      if (ns.type === 'personal' && ns.linkedUserId === uid) {
        out.push({ handle: ns.handle, role: 'owner' });
      }
    }
    for (const handle of this.userOrganizations.get(uid) ?? []) {
      const member = await this.getMember(handle, uid);
      if (member !== null) {
        if (!out.some((m) => m.handle === handle)) {
          out.push({ handle, role: member.role });
        }
      }
    }
    return out;
  }
}

function directoryWith(uid: string, metadata: { email: string | null; displayName: string | null }): UserDirectoryService {
  return {
    async getUsersByRole() {
      return [];
    },
    async getUserMetadata(requested: string) {
      if (requested !== uid) return null;
      return { ...metadata, lastSignInTime: null };
    },
  };
}

describe('getMe handler', () => {
  let namespaceRepo: InMemoryNamespaceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('rejects apiKey caller without an explicit uid (no identity to attribute)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo });
    await expect(getMe({}, scope)).rejects.toBeInstanceOf(ValidationError);
  });

  it('apiKey caller may target a uid explicitly (admin / CLI escape hatch)', async () => {
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({ namespaceRepo, auditRepo, userDirectory: directory });

    const result = await getMe({ uid: 'uid-marek' }, scope);

    expect(result.user.uid).toBe('uid-marek');
    expect(result.namespaces[0]?.handle).toBe('marek');
  });

  it('rejects a user caller asking for a different uid', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', []),
    });

    await expect(getMe({ uid: 'uid-other' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates personal namespace inline when missing and returns it as owner', async () => {
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', []),
    });

    const result = await getMe({}, scope);

    expect(result.user).toEqual({ uid: 'uid-marek', email: 'marek@example.test', displayName: 'Marek' });
    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0]).toMatchObject({
      handle: 'marek',
      type: 'personal',
      role: 'owner',
    });
    expect(namespaceRepo.namespaces.get('marek')?.linkedUserId).toBe('uid-marek');
    const members = namespaceRepo.members.get('marek') ?? [];
    expect(members.map((m) => m.uid)).toEqual(['uid-marek']);
  });

  it('emits user.personal_namespace_created exactly once when bootstrap runs', async () => {
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', []),
    });

    await getMe({}, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'user.personal_namespace_created');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('marek');
  });

  it('does not create or emit when personal namespace already exists', async () => {
    namespaceRepo.setNamespace({
      handle: 'marek',
      type: 'personal',
      displayName: 'Marek',
      linkedUserId: 'uid-marek',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.setMembership('marek', {
      uid: 'uid-marek',
      role: 'owner',
      joinedAt: '2026-01-01T00:00:00.000Z',
    });
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', ['marek']),
    });

    const result = await getMe({}, scope);

    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0]?.handle).toBe('marek');
    expect(auditRepo.getAll().some((e) => e.action === 'user.personal_namespace_created')).toBe(false);
  });

  it('is idempotent across repeat calls — only the first creates', async () => {
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', []),
    });

    await getMe({}, scope);
    // Second call: simulate the route layer rebuilding scope.caller from the
    // bootstrapped membership (which is what `resolveCallerIdentity` does).
    const scope2 = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', ['marek'], new Map([['marek', 'owner']])),
    });
    const second = await getMe({}, scope2);

    expect(second.namespaces).toHaveLength(1);
    const createdEvents = auditRepo.getAll().filter((e) => e.action === 'user.personal_namespace_created');
    expect(createdEvents).toHaveLength(1);
  });

  it('includes organization memberships with their role alongside the personal namespace', async () => {
    namespaceRepo.setNamespace({
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.setMembership('acme', {
      uid: 'uid-marek',
      role: 'admin',
      joinedAt: '2026-02-01T00:00:00.000Z',
    });
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', ['acme'], new Map([['acme', 'admin']])),
    });

    const result = await getMe({}, scope);

    const handlesAndRoles = result.namespaces.map((n) => [n.handle, n.role]).sort();
    expect(handlesAndRoles).toEqual([
      ['acme', 'admin'],
      ['marek', 'owner'],
    ]);
  });

  it('returns nullable user fields when userDirectory is unconfigured', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: null,
      caller: userCaller('uid-marek', []),
    });

    const result = await getMe({}, scope);

    expect(result.user.email).toBeNull();
    expect(result.user.displayName).toBeNull();
    // No userDirectory → email is null, so generateHandle falls back to the
    // uid as seed. `'uid-marek'` is already a valid handle, so no further
    // transformation; the PERSONAL_HANDLE_FALLBACK ('user') only kicks in
    // when the seed sanitises down to an empty string.
    expect(result.namespaces[0]?.handle).toBe('uid-marek');
  });

  it('appends a numeric suffix when the base handle is already taken', async () => {
    namespaceRepo.setNamespace({
      handle: 'marek',
      type: 'personal',
      displayName: 'someone else',
      linkedUserId: 'uid-other',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const directory = directoryWith('uid-marek', { email: 'marek@example.test', displayName: 'Marek' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      userDirectory: directory,
      caller: userCaller('uid-marek', []),
    });

    const result = await getMe({}, scope);

    expect(result.namespaces[0]?.handle).toBe('marek-2');
    expect(result.namespaces[0]?.role).toBe('owner');
  });
});
