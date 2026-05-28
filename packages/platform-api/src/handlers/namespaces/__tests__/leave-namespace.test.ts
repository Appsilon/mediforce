import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { leaveNamespace } from '../leave-namespace.js';
import { ForbiddenError, NotFoundError, PreconditionFailedError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { InMemoryNamespaceRepo } from './in-memory-namespace-repo.js';

describe('leaveNamespace handler', () => {
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

  it('removes the caller from the workspace and arrayRemoves organizations', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member', ['acme'], new Map([['acme', 'member']])),
    });

    const result = await leaveNamespace({ handle: 'acme' }, scope);

    expect(result).toEqual({ handle: 'acme' });
    expect(namespaceRepo.members.get('acme')?.map((m) => m.uid)).toEqual(['uid-owner']);
    expect(namespaceRepo.userOrganizations.get('uid-member')).toEqual([]);
  });

  it('owner cannot leave — precondition_failed', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await expect(leaveNamespace({ handle: 'acme' }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(namespaceRepo.members.get('acme')?.map((m) => m.uid)).toContain('uid-owner');
  });

  it('rejects apiKey caller (no `self` for a system actor)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo });
    await expect(leaveNamespace({ handle: 'acme' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cannot leave a personal namespace', async () => {
    namespaceRepo.seedNamespace({
      handle: 'marek',
      type: 'personal',
      displayName: 'Marek',
      linkedUserId: 'uid-marek',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.seedMember('marek', { uid: 'uid-marek', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', ['marek'], new Map([['marek', 'owner']])),
    });

    await expect(leaveNamespace({ handle: 'marek' }, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it('not-found namespace surfaces as NotFoundError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member', [], new Map()),
    });
    await expect(leaveNamespace({ handle: 'ghost' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('non-member surfaces as anti-enum NotFoundError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-stranger', [], new Map()),
    });
    await expect(leaveNamespace({ handle: 'acme' }, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.member_left on success', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member', ['acme'], new Map([['acme', 'member']])),
    });

    await leaveNamespace({ handle: 'acme' }, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.member_left');
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe('uid-member');
    expect(events[0]?.entityId).toBe('acme');
  });
});
