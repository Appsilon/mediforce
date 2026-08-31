import { describe, it, expect, beforeEach } from 'vitest';
import type { Namespace, UserDirectoryService } from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import {
  InMemoryNamespaceRepo,
  createTestScope,
  stubUserDirectory,
  userCaller,
} from '../../../testing/index';
import { getMe } from '../get-me';

/**
 * Domain auto-join (`AUTO_JOIN_WORKSPACES`) reconciled inside `getMe`.
 *
 * The three cases that are silent when they go wrong all live here: a promoted
 * member being demoted back by the next page load, a removal being undone by
 * it, and an out-of-domain user being let in.
 */
const ORG: Namespace = {
  handle: 'appsilon',
  type: 'organization',
  displayName: 'Appsilon',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const RULES = [{ domain: 'appsilon.com', handle: 'appsilon' }];

function directoryWith(uid: string, email: string | null): UserDirectoryService {
  return stubUserDirectory({
    async getUserMetadata(requested: string) {
      if (requested !== uid) return null;
      return { email, displayName: 'Alice', lastSignInTime: null, photoURL: null };
    },
  });
}

describe('getMe — domain auto-join', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  function scopeFor(uid: string, email: string | null, autoJoinWorkspaces = RULES) {
    return createTestScope({
      namespaceRepo,
      auditRepo,
      autoJoinWorkspaces,
      userDirectory: directoryWith(uid, email),
      caller: userCaller(uid, []),
    });
  }

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    auditRepo = new InMemoryAuditRepository();
    namespaceRepo.seedNamespace(ORG);
  });

  it('joins a matching-domain user as member and returns the workspace', async () => {
    const result = await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));

    expect(result.namespaces).toContainEqual(
      expect.objectContaining({ handle: 'appsilon', role: 'member' }),
    );
    expect(await namespaceRepo.getMember('appsilon', 'uid-1')).toMatchObject({ role: 'member' });
  });

  it('emits one audit event for the join and none on the next call', async () => {
    await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));
    await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));

    // Read back through `getByNamespace` rather than the raw list: `namespace`
    // is a write-time hint both backends strip once the workspace is resolved,
    // so this is what proves the event actually landed in the workspace.
    const page = await auditRepo.getByNamespace('appsilon');
    const joins = page.items.filter((e) => e.action === 'namespace.member_auto_joined');
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ entityType: 'namespace', entityId: 'appsilon' });
  });

  it('does not join a user whose domain no rule names', async () => {
    const result = await getMe({}, scopeFor('uid-2', 'mallory@evil.com'));

    expect(result.namespaces.map((n) => n.handle)).not.toContain('appsilon');
    expect(await namespaceRepo.getMember('appsilon', 'uid-2')).toBeNull();
  });

  it('does nothing when the feature is unconfigured', async () => {
    const result = await getMe({}, scopeFor('uid-1', 'alice@appsilon.com', []));

    expect(result.namespaces.map((n) => n.handle)).not.toContain('appsilon');
  });

  it('skips a rule naming a workspace that does not exist, without creating it', async () => {
    const rules = [{ domain: 'appsilon.com', handle: 'typo-handle' }];
    const result = await getMe({}, scopeFor('uid-1', 'alice@appsilon.com', rules));

    expect(result.namespaces.map((n) => n.handle)).not.toContain('typo-handle');
    expect(await namespaceRepo.getNamespace('typo-handle')).toBeNull();
  });

  it('leaves a promoted member alone — auto-join never demotes', async () => {
    await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));
    await namespaceRepo.setMemberRole('appsilon', 'uid-1', 'admin');

    const result = await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));

    expect(await namespaceRepo.getMember('appsilon', 'uid-1')).toMatchObject({ role: 'admin' });
    expect(result.namespaces).toContainEqual(
      expect.objectContaining({ handle: 'appsilon', role: 'admin' }),
    );
  });

  it('does not re-add someone who was removed', async () => {
    await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));
    await namespaceRepo.removeMemberWithOrganizations('appsilon', 'uid-1');

    const result = await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));

    expect(await namespaceRepo.getMember('appsilon', 'uid-1')).toBeNull();
    expect(result.namespaces.map((n) => n.handle)).not.toContain('appsilon');
  });

  it('lets an explicit re-add stick, and auto-join keeps it', async () => {
    await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));
    await namespaceRepo.removeMemberWithOrganizations('appsilon', 'uid-1');
    await namespaceRepo.addMember('appsilon', {
      uid: 'uid-1',
      role: 'admin',
      joinedAt: '2026-02-01T00:00:00.000Z',
    });

    await getMe({}, scopeFor('uid-1', 'alice@appsilon.com'));

    expect(await namespaceRepo.getMember('appsilon', 'uid-1')).toMatchObject({ role: 'admin' });
  });

  it('still returns the profile when a workspace join fails', async () => {
    const failing = new InMemoryNamespaceRepo();
    failing.seedNamespace(ORG);
    failing.addMember = async () => {
      throw new Error('storage down');
    };
    const scope = createTestScope({
      namespaceRepo: failing,
      auditRepo,
      autoJoinWorkspaces: RULES,
      userDirectory: directoryWith('uid-1', 'alice@appsilon.com'),
      caller: userCaller('uid-1', []),
    });

    const result = await getMe({}, scope);

    expect(result.user.uid).toBe('uid-1');
    expect(result.namespaces.map((n) => n.handle)).not.toContain('appsilon');
  });
});
