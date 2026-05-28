import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { updateNamespaceMemberRole } from '../update-member-role.js';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { InMemoryNamespaceRepo } from './in-memory-namespace-repo.js';

describe('updateNamespaceMemberRole handler', () => {
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

  it('owner promotes a member to admin; returns entity-echo', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    const result = await updateNamespaceMemberRole(
      { handle: 'acme', uid: 'uid-member', role: 'admin' },
      scope,
    );

    expect(result.member.role).toBe('admin');
    expect(namespaceRepo.members.get('acme')?.find((m) => m.uid === 'uid-member')?.role).toBe('admin');
  });

  it('admin cannot change roles (owner-only)', async () => {
    namespaceRepo.seedMember('acme', { uid: 'uid-admin', role: 'admin', joinedAt: '2026-01-03T00:00:00.000Z' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-admin', ['acme'], new Map([['acme', 'admin']])),
    });

    await expect(
      updateNamespaceMemberRole({ handle: 'acme', uid: 'uid-member', role: 'admin' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cannot change the workspace owner’s role', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await expect(
      updateNamespaceMemberRole({ handle: 'acme', uid: 'uid-owner', role: 'admin' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('unknown member surfaces as NotFoundError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await expect(
      updateNamespaceMemberRole({ handle: 'acme', uid: 'uid-ghost', role: 'admin' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.member_role_changed on success', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await updateNamespaceMemberRole({ handle: 'acme', uid: 'uid-member', role: 'admin' }, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.member_role_changed');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('acme');
  });
});
