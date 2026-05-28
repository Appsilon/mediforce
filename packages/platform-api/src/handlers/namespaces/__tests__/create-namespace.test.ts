import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Namespace,
  NamespaceMember,
  NamespaceMembership,
  NamespaceRepository,
} from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { createNamespace } from '../create-namespace.js';
import { ConflictError, ForbiddenError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

class InMemoryNamespaceRepository implements NamespaceRepository {
  readonly namespaces = new Map<string, Namespace>();
  readonly members = new Map<string, NamespaceMember[]>();
  readonly userOrganizations = new Map<string, string[]>();

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
    const members = this.members.get(input.namespace.handle) ?? [];
    this.members.set(input.namespace.handle, [
      ...members.filter((m) => m.uid !== input.ownerMember.uid),
      input.ownerMember,
    ]);
    const orgs = this.userOrganizations.get(input.ownerMember.uid) ?? [];
    if (!orgs.includes(input.namespace.handle)) {
      this.userOrganizations.set(input.ownerMember.uid, [...orgs, input.namespace.handle]);
    }
  }
  async updateNamespace(): Promise<void> {
    /* not exercised */
  }
  async getNamespacesByUser(): Promise<Namespace[]> {
    return [];
  }
  async addMember(): Promise<void> {
    /* not exercised */
  }
  async removeMember(): Promise<void> {
    /* not exercised */
  }
  async removeMemberWithOrganizations(): Promise<void> {
    /* not exercised */
  }
  async setMemberRole(): Promise<void> {
    /* not exercised */
  }
  async deleteNamespaceCascade(): Promise<void> {
    /* not exercised */
  }
  async getMember(handle: string, uid: string): Promise<NamespaceMember | null> {
    return this.members.get(handle)?.find((m) => m.uid === uid) ?? null;
  }
  async getMembers(handle: string): Promise<NamespaceMember[]> {
    return this.members.get(handle) ?? [];
  }
  async getUserNamespaces(): Promise<Namespace[]> {
    return [];
  }
  async getMembershipsForUser(): Promise<readonly NamespaceMembership[]> {
    return [];
  }
}

describe('createNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('creates organization with owner, returns entity-echo, emits namespace.created', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', []),
    });

    const result = await createNamespace(
      { handle: 'acme', displayName: 'Acme Co.' },
      scope,
    );

    expect(result.namespace).toMatchObject({
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
    });
    expect(namespaceRepo.namespaces.get('acme')?.type).toBe('organization');
    expect(namespaceRepo.members.get('acme')).toEqual([
      expect.objectContaining({ uid: 'uid-marek', role: 'owner' }),
    ]);
    expect(namespaceRepo.userOrganizations.get('uid-marek')).toEqual(['acme']);

    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.created');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('acme');
    expect(events[0]?.actorId).toBe('uid-marek');
  });

  it('persists optional bio when provided', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', []),
    });

    const result = await createNamespace(
      { handle: 'acme', displayName: 'Acme Co.', bio: 'A widget company.' },
      scope,
    );

    expect(result.namespace.bio).toBe('A widget company.');
  });

  it('throws ConflictError when the handle already exists', async () => {
    namespaceRepo.namespaces.set('acme', {
      handle: 'acme',
      type: 'organization',
      displayName: 'someone else',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', []),
    });

    await expect(
      createNamespace({ handle: 'acme', displayName: 'Acme Co.' }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(auditRepo.getAll().some((e) => e.action === 'namespace.created')).toBe(false);
  });

  it('rejects apiKey caller (no human owner to attribute the workspace to)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo });

    await expect(
      createNamespace({ handle: 'acme', displayName: 'Acme Co.' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
