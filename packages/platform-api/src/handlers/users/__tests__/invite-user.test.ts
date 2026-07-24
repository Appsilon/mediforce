import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryPlatformSettingsRepository,
} from '@mediforce/platform-core/testing';
import { InMemoryNamespaceRepo, createTestScope, userCaller } from '../../../testing/index';
import { inviteUser } from '../invite-user';
import { ForbiddenError, PreconditionFailedError } from '../../../errors';
import type {
  InviteNotificationService,
  InviteService,
  InvitedUser,
  SendWorkspaceNotificationEmailInput,
} from '../../../services/invite-notification';

function inviteServiceReturning(result: InvitedUser): InviteService {
  return {
    seedInvite: vi.fn(async () => result),
    getUserEmail: vi.fn(async () => null),
    isInvitePending: vi.fn(async () => true),
  };
}

function recordingNotifier(): InviteNotificationService & {
  sendWorkspaceCalls: SendWorkspaceNotificationEmailInput[];
} {
  const sendWorkspaceCalls: SendWorkspaceNotificationEmailInput[] = [];
  return {
    sendWorkspaceCalls,
    async sendWorkspaceNotificationEmail(input) {
      sendWorkspaceCalls.push(input);
    },
  };
}

const adminRoles = new Map([['alpha', 'admin' as const]]);
const ownerRoles = new Map([['alpha', 'owner' as const]]);
const memberRoles = new Map([['alpha', 'member' as const]]);

const baseInput = {
  email: 'newbie@example.test',
  namespaceHandle: 'alpha',
  role: 'member' as const,
};

describe('inviteUser handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    auditRepo = new InMemoryAuditRepository();
  });

  it('seeds a brand-new user for an apiKey caller and sends the workspace-notification email', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    const result = await inviteUser(baseInput, scope);

    expect(result).toEqual({
      uid: 'uid-new',
      email: 'newbie@example.test',
      emailSent: true,
      isExisting: false,
    });
    expect(inviteService.seedInvite).toHaveBeenCalledWith({
      email: 'newbie@example.test',
      workspaceHandle: 'alpha',
      membership: 'member',
      roles: [],
    });
    expect(notifier.sendWorkspaceCalls).toEqual([
      {
        toEmail: 'newbie@example.test',
        inviterName: 'alpha',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
      },
    ]);
  });

  it('lower-cases + trims the email and forwards displayName to seedInvite', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    await inviteUser(
      { ...baseInput, email: '  NewBie@Example.TEST  ', displayName: '  Newbie  ' },
      scope,
    );

    expect(inviteService.seedInvite).toHaveBeenCalledWith({
      email: 'newbie@example.test',
      displayName: 'Newbie',
      workspaceHandle: 'alpha',
      membership: 'member',
      roles: [],
    });
  });

  it('forwards an admin membership to seedInvite', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({ namespaceRepo, auditRepo, inviteService });

    await inviteUser({ ...baseInput, role: 'admin' }, scope);

    expect(inviteService.seedInvite).toHaveBeenCalledWith(
      expect.objectContaining({ membership: 'admin' }),
    );
  });

  it('proceeds for an owner caller of the namespace', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      caller: userCaller('u-owner', ['alpha'], ownerRoles),
    });

    const result = await inviteUser(baseInput, scope);
    expect(result.uid).toBe('uid-new');
  });

  it('proceeds for an admin caller of the namespace', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await inviteUser(baseInput, scope);
    expect(result.uid).toBe('uid-new');
  });

  it('throws ForbiddenError for a plain member of the namespace', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(inviteUser(baseInput, scope)).rejects.toBeInstanceOf(ForbiddenError);
    expect(inviteService.seedInvite).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError for a caller not in the namespace', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      caller: userCaller('u-stranger', ['beta']),
    });

    await expect(inviteUser(baseInput, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws PreconditionFailedError when inviteService is null', async () => {
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService: null,
    });

    await expect(inviteUser(baseInput, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it('sends the workspace-notification email with the resolved workspace name for an existing user', async () => {
    namespaceRepo.seedNamespace({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Workspace',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const inviteService = inviteServiceReturning({ uid: 'uid-existing', isExisting: true });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    const result = await inviteUser({ ...baseInput, inviterName: 'Marek' }, scope);

    expect(result.isExisting).toBe(true);
    expect(notifier.sendWorkspaceCalls).toEqual([
      {
        toEmail: 'newbie@example.test',
        inviterName: 'Marek',
        workspaceName: 'Alpha Workspace',
        workspaceHandle: 'alpha',
      },
    ]);
  });

  it('falls back to the namespace handle when the namespace has no displayName', async () => {
    // No namespace doc seeded → fallback path.
    const inviteService = inviteServiceReturning({ uid: 'uid-existing', isExisting: true });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    await inviteUser(baseInput, scope);

    expect(notifier.sendWorkspaceCalls[0]).toMatchObject({
      workspaceName: 'alpha',
      inviterName: 'alpha',
    });
  });

  it('treats email-send failures as non-fatal (emailSent=false, no throw)', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier: InviteNotificationService = {
      async sendWorkspaceNotificationEmail() {
        throw new Error('mailgun down');
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    const result = await inviteUser(baseInput, scope);

    expect(result.emailSent).toBe(false);
    expect(result.uid).toBe('uid-new');
    consoleError.mockRestore();
  });

  it('returns emailSent=false when inviteNotificationService is null', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: null,
    });

    const result = await inviteUser(baseInput, scope);

    expect(result.emailSent).toBe(false);
    expect(result.uid).toBe('uid-new');
    expect(inviteService.seedInvite).toHaveBeenCalledTimes(1);
  });

  it('passes the configured platform.baseUrl through to the workspace-notification email', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('platform.baseUrl', 'https://phuse.mediforce.ai');
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      platformSettingsRepo,
    });

    await inviteUser(baseInput, scope);

    expect(notifier.sendWorkspaceCalls).toEqual([
      {
        toEmail: 'newbie@example.test',
        inviterName: 'alpha',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
        baseUrl: 'https://phuse.mediforce.ai',
      },
    ]);
  });

  it('passes the configured platform.baseUrl through to the workspace-notification email (trailing slash trimmed)', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('platform.baseUrl', 'https://phuse.mediforce.ai/');
    const inviteService = inviteServiceReturning({
      uid: 'uid-existing',
      isExisting: true,
    });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      platformSettingsRepo,
    });

    await inviteUser({ ...baseInput, inviterName: 'Marek' }, scope);

    expect(notifier.sendWorkspaceCalls[0]).toMatchObject({
      baseUrl: 'https://phuse.mediforce.ai',
    });
  });

  it('omits baseUrl when platform.baseUrl is unset', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    await inviteUser(baseInput, scope);

    expect(notifier.sendWorkspaceCalls[0].baseUrl).toBeUndefined();
  });

  it('omits baseUrl when platform.baseUrl is cleared to whitespace (falls back, never an empty URL)', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('platform.baseUrl', '   ');
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      platformSettingsRepo,
    });

    await inviteUser(baseInput, scope);

    expect(notifier.sendWorkspaceCalls[0].baseUrl).toBeUndefined();
  });

  it('writes an invitation.created audit event attributed to the caller', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    await inviteUser(baseInput, scope);

    const events = await auditRepo.getByEntity('invitation', 'uid-new');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'invitation.created',
      actorId: 'u-admin',
      actorType: 'user',
      entityType: 'invitation',
      entityId: 'uid-new',
    });
    expect(events[0].outputSnapshot).toMatchObject({
      uid: 'uid-new',
      isExisting: false,
      emailSent: false,
    });
  });
});
