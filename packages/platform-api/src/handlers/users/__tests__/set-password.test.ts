import { describe, it, expect, beforeEach } from 'vitest';
import { compare } from 'bcryptjs';
import {
  InMemoryAuditRepository,
  InMemoryCredentialsRepository,
  InMemoryNamespaceRepository,
} from '@mediforce/platform-core/testing';
import { setPassword } from '../set-password';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../errors';
import { SetPasswordInputSchema } from '../../../contract/users';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

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
    const stored = credentialsRepo.getPasswordHash('uid-marek');
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
    expect(credentialsRepo.getPasswordHash('uid-other')).toBeNull();
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
    expect(await compare('correct-horse', credentialsRepo.getPasswordHash('uid-target') as string)).toBe(true);
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
    expect(serialized).not.toContain(credentialsRepo.getPasswordHash('uid-marek'));
    expect(serialized).not.toContain('$2');
  });
});
