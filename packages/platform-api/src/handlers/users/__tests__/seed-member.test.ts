import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryPlatformSettingsRepository,
  InMemoryUserProfileRepository,
} from '@mediforce/platform-core/testing';
import { InMemoryNamespaceRepo, createTestScope } from '../../../testing/index';
import { seedMemberAndNotify } from '../seed-member';
import { PreconditionFailedError } from '../../../errors';
import { PLATFORM_BASE_URL_SETTING_KEY } from '../../../contract/config';
import type {
  InviteNotificationService,
  InviteService,
  SendActivationEmailInput,
  SendWorkspaceNotificationEmailInput,
} from '../../../services/invite-notification';

/**
 * The seed-and-notify step shared by `inviteUser` and `redeemJoinLink`
 * (ADR-0021 §4). Tested here rather than only through its two callers because
 * the sharing IS the decision: a redemption must produce the same seed and the
 * same email as an admin invite, not a second implementation that agrees today.
 */

function inviteServiceReturning(
  result: { uid: string; isExisting: boolean },
  pending = true,
): InviteService {
  return {
    seedInvite: vi.fn(async () => result),
    getUserEmail: vi.fn(async () => null),
    isInvitePending: vi.fn(async () => pending),
  };
}

function recordingNotifier(): InviteNotificationService & {
  activationCalls: SendActivationEmailInput[];
  workspaceCalls: SendWorkspaceNotificationEmailInput[];
} {
  const activationCalls: SendActivationEmailInput[] = [];
  const workspaceCalls: SendWorkspaceNotificationEmailInput[] = [];
  return {
    activationCalls,
    workspaceCalls,
    async sendActivationEmail(input) {
      activationCalls.push(input);
    },
    async sendWorkspaceNotificationEmail(input) {
      workspaceCalls.push(input);
    },
  };
}

const baseParams = {
  email: 'newbie@example.test',
  namespaceHandle: 'alpha',
  membership: 'member' as const,
  vouchedByAdmin: true,
};

describe('seedMemberAndNotify', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.seedNamespace({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Labs',
      createdAt: new Date().toISOString(),
    });
    auditRepo = new InMemoryAuditRepository();
  });

  it('sends the activation email to a pending invitee and arms the create-password gate', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const notifier = recordingNotifier();
    const userProfileRepo = new InMemoryUserProfileRepository();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
      userProfileRepo,
    });

    const result = await seedMemberAndNotify(baseParams, scope);

    expect(result).toEqual({
      uid: 'uid-new',
      isExisting: false,
      emailSent: true,
      workspaceName: 'Alpha Labs',
    });
    expect(notifier.activationCalls).toHaveLength(1);
    expect(notifier.workspaceCalls).toHaveLength(0);
    expect(await userProfileRepo.getProfile('uid-new')).toMatchObject({
      mustChangePassword: true,
    });
  });

  it('sends the plain workspace notification to somebody who is already active', async () => {
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService: inviteServiceReturning({ uid: 'uid-old', isExisting: true }, false),
      inviteNotificationService: notifier,
    });

    await seedMemberAndNotify(baseParams, scope);

    expect(notifier.workspaceCalls).toHaveLength(1);
    expect(notifier.activationCalls).toHaveLength(0);
  });

  it('does not force a password where password auth is off — the invitee could never set one', async () => {
    const userProfileRepo = new InMemoryUserProfileRepository();
    const setMustChangePassword = vi.spyOn(userProfileRepo, 'setMustChangePassword');
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService: inviteServiceReturning({ uid: 'uid-new', isExisting: false }),
      inviteNotificationService: recordingNotifier(),
      userProfileRepo,
      passwordAuthEnabled: false,
    });

    await seedMemberAndNotify(baseParams, scope);

    expect(setMustChangePassword).not.toHaveBeenCalled();
  });

  it('prefers the deployment’s configured base URL for the link', async () => {
    const notifier = recordingNotifier();
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set(PLATFORM_BASE_URL_SETTING_KEY, 'https://phuse.example/');
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService: inviteServiceReturning({ uid: 'uid-new', isExisting: false }),
      inviteNotificationService: notifier,
      platformSettingsRepo,
    });

    await seedMemberAndNotify(baseParams, scope);

    expect(notifier.activationCalls[0]?.baseUrl).toBe('https://phuse.example');
  });

  it('falls back to the workspace name when no inviter is named', async () => {
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService: inviteServiceReturning({ uid: 'uid-new', isExisting: false }),
      inviteNotificationService: notifier,
    });

    await seedMemberAndNotify({ ...baseParams, inviterName: '   ' }, scope);

    expect(notifier.activationCalls[0]?.inviterName).toBe('Alpha Labs');
  });

  it('still seeds the membership when email delivery throws', async () => {
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: {
        async sendActivationEmail() {
          throw new Error('mailgun is down');
        },
        async sendWorkspaceNotificationEmail() {
          throw new Error('mailgun is down');
        },
      },
    });

    const result = await seedMemberAndNotify(baseParams, scope);

    expect(result.emailSent).toBe(false);
    expect(inviteService.seedInvite).toHaveBeenCalledTimes(1);
  });

  it('passes the caller\u2019s vouching straight through to the seed', async () => {
    // The flag decides whether the seed may touch an account that already
    // exists at all, so `seedMemberAndNotify` must not have an opinion of its
    // own about it — `redeemJoinLink` is the caller that passes `false`.
    const inviteService = inviteServiceReturning({ uid: 'uid-new', isExisting: false });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: recordingNotifier(),
    });

    await seedMemberAndNotify({ ...baseParams, vouchedByAdmin: false }, scope);

    expect(inviteService.seedInvite).toHaveBeenCalledWith(
      expect.objectContaining({ vouchedByAdmin: false }),
    );
  });

  it('resolves the workspace name even with no notification service wired', async () => {
    // `/join`'s success page shows this, and the preview beside it always has
    // the display name — printing the handle on an email-disabled deployment
    // would make the two disagree about what the workspace is called.
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService: inviteServiceReturning({ uid: 'uid-new', isExisting: false }),
      inviteNotificationService: null,
    });

    const result = await seedMemberAndNotify(baseParams, scope);

    expect(result.workspaceName).toBe('Alpha Labs');
    expect(result.emailSent).toBe(false);
  });

  it('falls back to the handle when the workspace read fails', async () => {
    // The membership is committed by this point, so a failed read must not
    // throw — that would 500 after a successful write and skip the audit.
    const failingRepo = new InMemoryNamespaceRepo();
    failingRepo.getNamespace = async () => {
      throw new Error('workspaces unavailable');
    };
    const scope = createTestScope({
      namespaceRepo: failingRepo,
      auditRepo,
      inviteService: inviteServiceReturning({ uid: 'uid-new', isExisting: false }),
      inviteNotificationService: recordingNotifier(),
    });

    const result = await seedMemberAndNotify(baseParams, scope);

    expect(result.workspaceName).toBe('alpha');
    expect(result.uid).toBe('uid-new');
  });

  it('refuses when the deployment is not wired for invites', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, inviteService: null });

    await expect(seedMemberAndNotify(baseParams, scope)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });
});
