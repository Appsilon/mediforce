import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index.js';
import { createNamespace } from '../create-namespace.js';
import { ConflictError, ForbiddenError } from '../../../errors.js';

describe('createNamespace handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
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
