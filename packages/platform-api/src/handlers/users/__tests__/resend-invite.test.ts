import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryPlatformSettingsRepository,
  InMemoryUserProfileRepository,
} from '@mediforce/platform-core/testing';
import { resendInvite } from '../resend-invite';
import {
  ForbiddenError,
  HandlerError,
  PreconditionFailedError,
} from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type {
  InviteNotificationService,
  InviteService,
  SendActivationEmailInput,
  SendWorkspaceNotificationEmailInput,
} from '../../../services/invite-notification';

interface InviteServiceStub {
  email: string | null;
  pending: boolean;
}

function inviteServiceStub(stub: InviteServiceStub): InviteService {
  return {
    seedInvite: vi.fn(async () => ({ uid: 'unused', isExisting: false })),
    getUserEmail: vi.fn(async () => stub.email),
    isInvitePending: vi.fn(async () => stub.pending),
  };
}

function recordingNotifier(): InviteNotificationService & {
  sendWorkspaceCalls: SendWorkspaceNotificationEmailInput[];
  sendActivationCalls: SendActivationEmailInput[];
} {
  const sendWorkspaceCalls: SendWorkspaceNotificationEmailInput[] = [];
  const sendActivationCalls: SendActivationEmailInput[] = [];
  return {
    sendWorkspaceCalls,
    sendActivationCalls,
    async sendWorkspaceNotificationEmail(input) {
      sendWorkspaceCalls.push(input);
    },
    async sendActivationEmail(input) {
      sendActivationCalls.push(input);
    },
  };
}

const adminRoles = new Map([['alpha', 'admin' as const]]);
const memberRoles = new Map([['alpha', 'member' as const]]);

const baseInput = {
  uid: 'uid-target',
  namespaceHandle: 'alpha',
};

describe('resendInvite handler', () => {
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    auditRepo = new InMemoryAuditRepository();
  });

  it('re-sends a fresh activation email, re-arms the gate, and audits for an apiKey caller', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const notifier = recordingNotifier();
    const userProfileRepo = new InMemoryUserProfileRepository();
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      userProfileRepo,
    });

    const result = await resendInvite(baseInput, scope);

    expect(result).toEqual({
      uid: 'uid-target',
      email: 'pending@example.test',
      emailSent: true,
    });
    expect(inviteService.isInvitePending).toHaveBeenCalledWith('uid-target');
    expect((await userProfileRepo.getProfile('uid-target'))?.mustChangePassword).toBe(true);
    expect(notifier.sendActivationCalls).toEqual([
      {
        toEmail: 'pending@example.test',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
        passwordSetupEnabled: true,
      },
    ]);
    expect(notifier.sendWorkspaceCalls).toHaveLength(0);
  });

  it('does not re-arm the gate but still sends a working sign-in link when password auth is disabled', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const notifier = recordingNotifier();
    const userProfileRepo = new InMemoryUserProfileRepository();
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      userProfileRepo,
      passwordAuthEnabled: false,
    });

    const result = await resendInvite(baseInput, scope);

    expect(result.emailSent).toBe(true);
    expect(await userProfileRepo.getProfile('uid-target')).toBeNull();
    // A pending invitee has no session, so the recovery must still carry a way
    // in — only the create-password framing is dropped.
    expect(notifier.sendActivationCalls).toEqual([
      {
        toEmail: 'pending@example.test',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
        passwordSetupEnabled: false,
      },
    ]);
    expect(notifier.sendWorkspaceCalls).toHaveLength(0);
  });

  it('passes the configured platform.baseUrl through to the resent activation email', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('platform.baseUrl', 'https://phuse.mediforce.ai');
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      platformSettingsRepo,
    });

    await resendInvite(baseInput, scope);

    expect(notifier.sendActivationCalls).toEqual([
      {
        toEmail: 'pending@example.test',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
        baseUrl: 'https://phuse.mediforce.ai',
        passwordSetupEnabled: true,
      },
    ]);
  });

  it('proceeds for an admin caller of the namespace', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const scope = createTestScope({
      auditRepo,
      inviteService,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    const result = await resendInvite(baseInput, scope);
    expect(result.uid).toBe('uid-target');
  });

  it('throws ForbiddenError for a plain member caller', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const scope = createTestScope({
      auditRepo,
      inviteService,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(resendInvite(baseInput, scope)).rejects.toBeInstanceOf(ForbiddenError);
    expect(inviteService.isInvitePending).not.toHaveBeenCalled();
  });

  it('throws PreconditionFailedError when inviteService is null', async () => {
    const scope = createTestScope({
      auditRepo,
      inviteService: null,
    });

    await expect(resendInvite(baseInput, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });

  it('throws HandlerError(validation) when the user has no email', async () => {
    const inviteService = inviteServiceStub({
      email: null,
      pending: true,
    });
    const scope = createTestScope({
      auditRepo,
      inviteService,
    });

    const err = await resendInvite(baseInput, scope).catch((e) => e);
    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).code).toBe('validation');
    expect(inviteService.isInvitePending).not.toHaveBeenCalled();
  });

  it('throws PreconditionFailedError when the invite is no longer pending', async () => {
    const inviteService = inviteServiceStub({
      email: 'active@example.test',
      pending: false,
    });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    await expect(resendInvite(baseInput, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
    expect(notifier.sendActivationCalls).toHaveLength(0);
    expect(notifier.sendWorkspaceCalls).toHaveLength(0);
  });

  it('treats email-send failures as non-fatal (emailSent=false, no throw)', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const notifier: InviteNotificationService = {
      async sendWorkspaceNotificationEmail() {
        throw new Error('mailgun down');
      },
      async sendActivationEmail() {
        throw new Error('mailgun down');
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    const result = await resendInvite(baseInput, scope);

    expect(result.emailSent).toBe(false);
    expect(result.email).toBe('pending@example.test');
    consoleError.mockRestore();
  });

  it('re-arms the gate even when inviteNotificationService is null', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const userProfileRepo = new InMemoryUserProfileRepository();
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: null,
      userProfileRepo,
    });

    const result = await resendInvite(baseInput, scope);

    expect(result.emailSent).toBe(false);
    expect(result.email).toBe('pending@example.test');
    expect((await userProfileRepo.getProfile('uid-target'))?.mustChangePassword).toBe(true);
  });

  it('writes an invitation.resent audit event attributed to the caller', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const scope = createTestScope({
      auditRepo,
      inviteService,
      caller: userCaller('u-admin', ['alpha'], adminRoles),
    });

    await resendInvite(baseInput, scope);

    const events = await auditRepo.getByEntity('invitation', 'uid-target');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'invitation.resent',
      actorId: 'u-admin',
      actorType: 'user',
      entityType: 'invitation',
      entityId: 'uid-target',
    });
    expect(events[0].outputSnapshot).toMatchObject({
      uid: 'uid-target',
      emailSent: false,
    });
  });
});
