import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { removeNamespaceMember } from '../remove-member.js';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { InMemoryNamespaceRepo } from './in-memory-namespace-repo.js';

describe('removeNamespaceMember handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.seedNamespace({
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.seedMember('acme', { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    namespaceRepo.seedMember('acme', { uid: 'uid-member', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' });
    auditRepo = new InMemoryAuditRepository();
  });

  it('admin removes a regular member; atomic with organizations arrayRemove', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'admin']])),
    });

    const result = await removeNamespaceMember({ handle: 'acme', uid: 'uid-member' }, scope);

    expect(result).toEqual({ handle: 'acme', uid: 'uid-member' });
    expect(namespaceRepo.members.get('acme')?.map((m) => m.uid)).toEqual(['uid-owner']);
    expect(namespaceRepo.userOrganizations.get('uid-member')).toEqual([]);
  });

  it('member role cannot remove anyone', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member', ['acme'], new Map([['acme', 'member']])),
    });

    await expect(
      removeNamespaceMember({ handle: 'acme', uid: 'uid-owner' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cannot remove the workspace owner', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-admin', ['acme'], new Map([['acme', 'admin']])),
    });

    await expect(
      removeNamespaceMember({ handle: 'acme', uid: 'uid-owner' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
    expect(namespaceRepo.members.get('acme')?.map((m) => m.uid)).toContain('uid-owner');
  });

  it('unknown member surfaces as NotFoundError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await expect(
      removeNamespaceMember({ handle: 'acme', uid: 'uid-ghost' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.member_removed on success', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await removeNamespaceMember({ handle: 'acme', uid: 'uid-member' }, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.member_removed');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('acme');
  });
});
