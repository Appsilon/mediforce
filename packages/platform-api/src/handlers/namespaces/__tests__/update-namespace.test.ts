import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { updateNamespace } from '../update-namespace.js';
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
  bio: 'Widgets',
  icon: 'Building2',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('updateNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.seedNamespace(SEED);
    auditRepo = new InMemoryAuditRepository();
  });

  it('updates displayName/bio/icon and returns the entity-echo', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    const result = await updateNamespace(
      { handle: 'acme', displayName: 'Acme Inc.', icon: 'Briefcase', bio: 'New tagline' },
      scope,
    );

    expect(result.namespace.displayName).toBe('Acme Inc.');
    expect(result.namespace.icon).toBe('Briefcase');
    expect(result.namespace.bio).toBe('New tagline');
    expect(namespaceRepo.namespaces.get('acme')?.displayName).toBe('Acme Inc.');
  });

  it('clears bio when passed null', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await updateNamespace({ handle: 'acme', bio: null }, scope);

    expect(namespaceRepo.namespaces.get('acme')?.bio).toBeUndefined();
  });

  it('admins may edit (not just owners)', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-admin', ['acme'], new Map([['acme', 'admin']])),
    });

    await expect(
      updateNamespace({ handle: 'acme', displayName: 'Edited' }, scope),
    ).resolves.toMatchObject({ namespace: { displayName: 'Edited' } });
  });

  it('rejects non-admin members with ForbiddenError', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-member', ['acme'], new Map([['acme', 'member']])),
    });

    await expect(
      updateNamespace({ handle: 'acme', displayName: 'Nope' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(namespaceRepo.namespaces.get('acme')?.displayName).toBe('Acme Co.');
  });

  it('throws NotFoundError when the namespace does not exist', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['unknown'], new Map([['unknown', 'owner']])),
    });

    await expect(
      updateNamespace({ handle: 'unknown', displayName: 'X' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits namespace.updated with the input snapshot', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-owner', ['acme'], new Map([['acme', 'owner']])),
    });

    await updateNamespace({ handle: 'acme', displayName: 'New' }, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'namespace.updated');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityId).toBe('acme');
    expect(events[0]?.actorId).toBe('uid-owner');
  });
});
