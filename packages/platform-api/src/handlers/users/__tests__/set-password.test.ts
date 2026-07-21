import { describe, it, expect, beforeEach } from 'vitest';
import { compare, hash } from 'bcryptjs';
import {
  InMemoryAuditRepository,
  InMemoryCredentialsRepository,
  InMemoryNamespaceRepository,
} from '@mediforce/platform-core/testing';
import { setPassword } from '../set-password';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import { SetPasswordInputSchema } from '../../../contract/users';
import type { CallerIdentity } from '../../../auth';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

/** bcrypt cost 4 — fast enough for tests, still a real hash to compare against. */
const TEST_BCRYPT_COST = 4;

describe('setPassword handler', () => {
  let credentialsRepo: InMemoryCredentialsRepository;
  let auditRepo: InMemoryAuditRepository;
  let namespaceRepo: InMemoryNamespaceRepository;

  async function seedPersonal(uid: string): Promise<void> {
    const now = new Date().toISOString();
    await namespaceRepo.createNamespaceWithOwner({
      namespace: { handle: uid, type: 'personal', displayName: uid, linkedUserId: uid, createdAt: now },
      ownerMember: { uid, role: 'owner', joinedAt: now },
    });
  }

  async function seedExistingPassword(uid: string, plaintext: string): Promise<void> {
    await credentialsRepo.setPasswordHash(uid, await hash(plaintext, TEST_BCRYPT_COST));
  }

  /** A user caller whose request carries a session token (as the route adapter builds it). */
  function userCallerWithSession(uid: string, sessionToken: string): CallerIdentity {
    return {
      kind: 'user',
      uid,
      namespaces: new Set<string>(),
      namespaceRoles: new Map(),
      sessionToken,
      isSystemActor: false,
    };
  }

  beforeEach(async () => {
    credentialsRepo = new InMemoryCredentialsRepository();
    auditRepo = new InMemoryAuditRepository();
    namespaceRepo = new InMemoryNamespaceRepository();
    // The password-set audit event is attributed to the user's personal
    // namespace (FK-valid `audit_events.workspace`).
    await seedPersonal('uid-marek');
    await seedPersonal('uid-target');
  });

  it('user caller stores a hash their password verifies against', async () => {
    const scope = createTestScope({
      credentialsRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    const result = await setPassword({ newPassword: 'correct-horse' }, scope);

    expect(result).toEqual({ user: { uid: 'uid-marek' } });
    const stored = await credentialsRepo.getPasswordHash('uid-marek');
    expect(stored).not.toBeNull();
    expect(await compare('correct-horse', stored as string)).toBe(true);
    expect(await compare('wrong-password', stored as string)).toBe(false);
  });

  it('rejects a password shorter than 8 characters at the contract boundary', () => {
    const parsed = SetPasswordInputSchema.safeParse({ newPassword: 'short' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('Password must be at least 8 characters.');
  });

  it('user caller cannot set another user’s password', async () => {
    const scope = createTestScope({
      credentialsRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    await expect(
      setPassword({ newPassword: 'correct-horse', uid: 'uid-other' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await credentialsRepo.getPasswordHash('uid-other')).toBeNull();
  });

  it('apiKey caller must pass uid explicitly', async () => {
    const scope = createTestScope({ credentialsRepo, auditRepo, namespaceRepo });
    await expect(
      setPassword({ newPassword: 'correct-horse' }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('apiKey caller may target a uid explicitly', async () => {
    const scope = createTestScope({ credentialsRepo, auditRepo, namespaceRepo });
    const result = await setPassword({ newPassword: 'correct-horse', uid: 'uid-target' }, scope);
    expect(result.user.uid).toBe('uid-target');
    expect(
      await compare('correct-horse', (await credentialsRepo.getPasswordHash('uid-target')) as string),
    ).toBe(true);
  });

  it('404s when no user row matches the uid', async () => {
    credentialsRepo.seedUser('uid-marek');
    const scope = createTestScope({ credentialsRepo, auditRepo, namespaceRepo });
    await expect(
      setPassword({ newPassword: 'correct-horse', uid: 'uid-target' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('emits user.password_set without leaking the password or its hash', async () => {
    const scope = createTestScope({
      credentialsRepo,
      auditRepo,
      namespaceRepo,
      caller: userCaller('uid-marek', []),
    });

    await setPassword({ newPassword: 'correct-horse' }, scope);

    const events = auditRepo.getAll().filter((e) => e.action === 'user.password_set');
    expect(events).toHaveLength(1);
    expect(events[0]?.entityType).toBe('user');
    expect(events[0]?.entityId).toBe('uid-marek');
    expect(events[0]?.actorId).toBe('uid-marek');

    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain('correct-horse');
    expect(serialized).not.toContain(await credentialsRepo.getPasswordHash('uid-marek'));
    expect(serialized).not.toContain('$2');
  });

  describe('re-authentication', () => {
    it('rejects a replacement with the wrong current password, writing nothing', async () => {
      await seedExistingPassword('uid-marek', 'old-password');
      const originalHash = await credentialsRepo.getPasswordHash('uid-marek');
      credentialsRepo.seedSession('uid-marek', 'session-other');
      const scope = createTestScope({
        credentialsRepo,
        auditRepo,
        namespaceRepo,
        caller: userCaller('uid-marek', []),
      });

      await expect(
        setPassword({ newPassword: 'brand-new-password', currentPassword: 'not-the-old-one' }, scope),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(await credentialsRepo.getPasswordHash('uid-marek')).toBe(originalHash);
      expect(await compare('old-password', originalHash as string)).toBe(true);
      // Nothing written also means nothing revoked.
      expect(credentialsRepo.listSessionTokens('uid-marek')).toEqual(['session-other']);
      expect(auditRepo.getAll().filter((e) => e.action === 'user.password_set')).toHaveLength(0);
    });

    it('rejects a replacement with no current password at all', async () => {
      await seedExistingPassword('uid-marek', 'old-password');
      const scope = createTestScope({
        credentialsRepo,
        auditRepo,
        namespaceRepo,
        caller: userCaller('uid-marek', []),
      });

      await expect(
        setPassword({ newPassword: 'brand-new-password' }, scope),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(await compare('old-password', (await credentialsRepo.getPasswordHash('uid-marek')) as string)).toBe(true);
    });

    it('accepts a replacement with the correct current password', async () => {
      await seedExistingPassword('uid-marek', 'old-password');
      const scope = createTestScope({
        credentialsRepo,
        auditRepo,
        namespaceRepo,
        caller: userCaller('uid-marek', []),
      });

      await setPassword(
        { newPassword: 'brand-new-password', currentPassword: 'old-password' },
        scope,
      );

      const stored = (await credentialsRepo.getPasswordHash('uid-marek')) as string;
      expect(await compare('brand-new-password', stored)).toBe(true);
      expect(await compare('old-password', stored)).toBe(false);
    });

    it('accepts a first-time set with no current password (invite / mustChangePassword path)', async () => {
      const scope = createTestScope({
        credentialsRepo,
        auditRepo,
        namespaceRepo,
        caller: userCaller('uid-marek', []),
      });

      await setPassword({ newPassword: 'brand-new-password' }, scope);

      expect(
        await compare('brand-new-password', (await credentialsRepo.getPasswordHash('uid-marek')) as string),
      ).toBe(true);
    });

    it('apiKey caller replaces an existing password without a current password', async () => {
      await seedExistingPassword('uid-target', 'old-password');
      const scope = createTestScope({ credentialsRepo, auditRepo, namespaceRepo });

      await setPassword({ newPassword: 'admin-reset-password', uid: 'uid-target' }, scope);

      expect(
        await compare('admin-reset-password', (await credentialsRepo.getPasswordHash('uid-target')) as string),
      ).toBe(true);
    });
  });

  describe('session revocation', () => {
    it('revokes the user’s other sessions and keeps the caller’s own', async () => {
      await seedExistingPassword('uid-marek', 'old-password');
      credentialsRepo.seedSession('uid-marek', 'session-caller');
      credentialsRepo.seedSession('uid-marek', 'session-laptop');
      credentialsRepo.seedSession('uid-marek', 'session-attacker');
      credentialsRepo.seedSession('uid-target', 'session-bystander');

      const scope = createTestScope({
        credentialsRepo,
        auditRepo,
        namespaceRepo,
        caller: userCallerWithSession('uid-marek', 'session-caller'),
      });

      await setPassword(
        { newPassword: 'brand-new-password', currentPassword: 'old-password' },
        scope,
      );

      expect(credentialsRepo.listSessionTokens('uid-marek')).toEqual(['session-caller']);
      // Another user's sessions are untouched.
      expect(credentialsRepo.listSessionTokens('uid-target')).toEqual(['session-bystander']);
    });

    it('revokes every session when an apiKey caller resets the password', async () => {
      credentialsRepo.seedSession('uid-target', 'session-a');
      credentialsRepo.seedSession('uid-target', 'session-b');
      const scope = createTestScope({ credentialsRepo, auditRepo, namespaceRepo });

      await setPassword({ newPassword: 'admin-reset-password', uid: 'uid-target' }, scope);

      expect(credentialsRepo.listSessionTokens('uid-target')).toEqual([]);
    });
  });
});
