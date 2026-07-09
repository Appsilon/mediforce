import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryNamespaceRepository,
  InMemoryUserProfileRepository,
} from '@mediforce/platform-core/testing';
import { clearMustChangePassword } from '../clear-must-change-password';
import { ForbiddenError, PreconditionFailedError, ValidationError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('clearMustChangePassword handler', () => {
  let userProfileRepo: InMemoryUserProfileRepository;
  let auditRepo: InMemoryAuditRepository;
  let namespaceRepo: InMemoryNamespaceRepository;

  async function seedPersonal(uid: string): Promise<void> {
    const now = new Date().toISOString();
    await namespaceRepo.createNamespaceWithOwner({
      namespace: { handle: uid, type: 'personal', displayName: uid, linkedUserId: uid, createdAt: now },
      ownerMember: { uid, role: 'owner', joinedAt: now },
    });
  }

  beforeEach(async () => {
    userProfileRepo = new InMemoryUserProfileRepository();
    auditRepo = new InMemoryAuditRepository();
    namespaceRepo = new InMemoryNamespaceRepository();
    // The forced-password-change audit event is attributed to the user's
    // personal namespace (FK-valid `audit_events.workspace`).
    await seedPersonal('uid-marek');
    await seedPersonal('uid-target');
  });

  it('user caller clears their own flag and gets a closed entity-echo', async () => {
    await userProfileRepo.setMustChangePassword('uid-marek', true);
    const scope = createTestScope({
      userProfileRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    const result = await clearMustChangePassword({}, scope);

    expect(result).toEqual({ user: { uid: 'uid-marek', mustChangePassword: false } });
    expect((await userProfileRepo.getProfile('uid-marek'))?.mustChangePassword).toBe(false);
  });

  it('user caller cannot clear another user’s flag', async () => {
    const scope = createTestScope({
      userProfileRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    await expect(
      clearMustChangePassword({ uid: 'uid-other' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('apiKey caller must pass uid explicitly', async () => {
    const scope = createTestScope({ userProfileRepo, auditRepo, namespaceRepo });
    await expect(clearMustChangePassword({}, scope)).rejects.toBeInstanceOf(ValidationError);
  });

  it('apiKey caller may target a uid explicitly', async () => {
    const scope = createTestScope({ userProfileRepo, auditRepo, namespaceRepo });
    const result = await clearMustChangePassword({ uid: 'uid-target' }, scope);
    expect(result.user.uid).toBe('uid-target');
    expect((await userProfileRepo.getProfile('uid-target'))?.mustChangePassword).toBe(false);
  });

  it('rejects when the user has no namespace to attribute the audit event to', async () => {
    const scope = createTestScope({ userProfileRepo, auditRepo, namespaceRepo });
    await expect(
      clearMustChangePassword({ uid: 'uid-orphan' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('emits user.password_change_acknowledged with the user as the entity', async () => {
    const scope = createTestScope({
      userProfileRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    await clearMustChangePassword({}, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'user.password_change_acknowledged');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityType).toBe('user');
    expect(events[0]?.entityId).toBe('uid-marek');
    expect(events[0]?.actorId).toBe('uid-marek');
  });

  it('is idempotent: clearing a never-set profile creates it with false', async () => {
    const scope = createTestScope({
      userProfileRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    await clearMustChangePassword({}, scope);
    await clearMustChangePassword({}, scope);

    expect((await userProfileRepo.getProfile('uid-marek'))?.mustChangePassword).toBe(false);
    const events = auditRepo.getAll().filter((e) => e.action === 'user.password_change_acknowledged');
    expect(events).toHaveLength(2);
  });
});
