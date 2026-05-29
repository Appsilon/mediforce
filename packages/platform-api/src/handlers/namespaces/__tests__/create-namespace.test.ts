import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import type { UserDirectoryService } from '@mediforce/platform-core';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index.js';
import { createNamespace } from '../create-namespace.js';
import { ConflictError, ForbiddenError } from '../../../errors.js';

function directoryWithMetadata(
  map: ReadonlyMap<string, { email: string | null; displayName: string | null; lastSignInTime: string | null; photoURL: string | null }>,
): UserDirectoryService {
  return {
    async getUsersByRole() {
      return [];
    },
    async getUserMetadata(uid: string) {
      return map.get(uid) ?? null;
    },
  };
}

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

  it('stores the caller Firebase Auth displayName on the owner member doc', async () => {
    const directory = directoryWithMetadata(
      new Map([
        ['uid-marek', { email: 'marek@example.test', displayName: 'Marek R', lastSignInTime: null, photoURL: null }],
      ]),
    );
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', []),
      userDirectory: directory,
    });

    await createNamespace({ handle: 'acme', displayName: 'Acme Co.' }, scope);

    expect(namespaceRepo.members.get('acme')).toEqual([
      expect.objectContaining({ uid: 'uid-marek', role: 'owner', displayName: 'Marek R' }),
    ]);
  });

  it('omits owner displayName when directory has no metadata for the caller', async () => {
    const directory = directoryWithMetadata(new Map());
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      caller: userCaller('uid-marek', []),
      userDirectory: directory,
    });

    await createNamespace({ handle: 'acme', displayName: 'Acme Co.' }, scope);

    const owner = namespaceRepo.members.get('acme')?.[0];
    expect(owner?.uid).toBe('uid-marek');
    expect(owner?.displayName).toBeUndefined();
  });

  it('rejects apiKey caller (no human owner to attribute the workspace to)', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo });

    await expect(
      createNamespace({ handle: 'acme', displayName: 'Acme Co.' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
