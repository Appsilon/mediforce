import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryPlatformSettingsRepository,
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

  it('re-sends the workspace-notification email and audits for an apiKey caller', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    const result = await resendInvite(baseInput, scope);

    expect(result).toEqual({
      uid: 'uid-target',
      email: 'pending@example.test',
      emailSent: true,
    });
    expect(inviteService.isInvitePending).toHaveBeenCalledWith('uid-target');
    expect(notifier.sendWorkspaceCalls).toEqual([
      {
        toEmail: 'pending@example.test',
        inviterName: 'alpha',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
      },
    ]);
  });

  it('passes the configured platform.baseUrl through to the resent workspace-notification email', async () => {
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

    expect(notifier.sendWorkspaceCalls).toEqual([
      {
        toEmail: 'pending@example.test',
        inviterName: 'alpha',
        workspaceName: 'alpha',
        workspaceHandle: 'alpha',
        baseUrl: 'https://phuse.mediforce.ai',
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

  it('returns emailSent=false when inviteNotificationService is null', async () => {
    const inviteService = inviteServiceStub({
      email: 'pending@example.test',
      pending: true,
    });
    const scope = createTestScope({
      auditRepo,
      inviteService,
      inviteNotificationService: null,
    });

    const result = await resendInvite(baseInput, scope);

    expect(result.emailSent).toBe(false);
    expect(result.email).toBe('pending@example.test');
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
