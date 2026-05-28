import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { deleteNamespace } from '../delete-namespace.js';
import { ForbiddenError, NotFoundError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { InMemoryNamespaceRepo } from './in-memory-namespace-repo.js';

const SEED = {
  handle: 'acme',
  type: 'organization' as const,
  displayName: 'Acme Co.',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('deleteNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.seedNamespace(SEED);
    namespaceRepo.seedMember('acme', { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    namespaceRepo.seedMember('acme', { uid: 'uid-member-a', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' });
    namespaceRepo.seedMember('acme', { uid: 'uid-member-b', role: 'admin', joinedAt: '2026-01-03T00:00:00.000Z' });
    auditRepo = new InMemoryAuditRepository();
  });

  it('cascade deletes the namespace, every member, and arrayRemoves organizations', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    const result = await deleteNamespace({ handle: 'acme' }, scope);

    expect(result).toEqual({ handle: 'acme' });
    expect(namespaceRepo.namespaces.get('acme')).toBeUndefined();
    expect(namespaceRepo.members.get('acme')).toBeUndefined();
    expect(namespaceRepo.userOrganizations.get('uid-owner')).toEqual([]);
    expect(namespaceRepo.userOrganizations.get('uid-member-a')).toEqual([]);
    expect(namespaceRepo.userOrganizations.get('uid-member-b')).toEqual([]);
  });

  it('rejects admin role with ForbiddenError (owner only)', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member-b', ['acme'], new Map([['acme', 'admin']])),
    });

    await expect(deleteNamespace({ handle: 'acme' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
    expect(namespaceRepo.namespaces.get('acme')).toBeDefined();
  });

  it('rejects member role with ForbiddenError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member-a', ['acme'], new Map([['acme', 'member']])),
    });

    await expect(deleteNamespace({ handle: 'acme' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws NotFoundError when the namespace does not exist', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['ghost'], new Map([['ghost', 'owner']])),
    });

    await expect(deleteNamespace({ handle: 'ghost' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.deleted exactly once on success', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await deleteNamespace({ handle: 'acme' }, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.deleted');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('acme');
  });
});
