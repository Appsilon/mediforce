import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Namespace,
  NamespaceMember,
  NamespaceMembership,
  NamespaceRepository,
} from '@mediforce/platform-core';
import { getNamespace } from '../get-namespace.js';
import { NotFoundError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

class InMemoryNamespaceRepository implements NamespaceRepository {
  readonly namespaces = new Map<string, Namespace>();
  readonly members = new Map<string, NamespaceMember[]>();

  async getNamespace(handle: string): Promise<Namespace | null> {
    return this.namespaces.get(handle) ?? null;
  }
  async createNamespace(): Promise<void> {
    /* not exercised */
  }
  async createNamespaceWithOwner(): Promise<void> {
    /* not exercised */
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
  async getMember(): Promise<NamespaceMember | null> {
    return null;
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

const ACME: Namespace = {
  handle: 'acme',
  type: 'organization',
  displayName: 'Acme Co.',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const ACME_MEMBERS: NamespaceMember[] = [
  { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
  { uid: 'uid-member', role: 'member', joinedAt: '2026-02-01T00:00:00.000Z' },
];

describe('getNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepository();
    namespaceRepo.namespaces.set('acme', ACME);
    namespaceRepo.members.set('acme', ACME_MEMBERS);
  });

  it('returns namespace + members for an apiKey caller', async () => {
    const scope = createTestScope({ namespaceRepo });

    const result = await getNamespace({ handle: 'acme' }, scope);

    expect(result.namespace).toEqual(ACME);
    expect(result.members).toHaveLength(2);
  });

  it('returns namespace + members for a member of the namespace', async () => {
    const scope = createTestScope({
      namespaceRepo,
      caller: userCaller('uid-member', ['acme']),
    });

    const result = await getNamespace({ handle: 'acme' }, scope);

    expect(result.namespace.handle).toBe('acme');
    expect(result.members.map((m) => m.uid)).toEqual(['uid-owner', 'uid-member']);
  });

  it('throws NotFoundError when the namespace does not exist', async () => {
    const scope = createTestScope({ namespaceRepo });

    await expect(getNamespace({ handle: 'missing' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError (anti-enum) when caller is not a namespace member', async () => {
    const scope = createTestScope({
      namespaceRepo,
      caller: userCaller('uid-stranger', ['beta']),
    });

    await expect(getNamespace({ handle: 'acme' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });
});
