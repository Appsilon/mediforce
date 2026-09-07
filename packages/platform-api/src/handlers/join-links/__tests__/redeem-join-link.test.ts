import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryUserProfileRepository,
} from '@mediforce/platform-core/testing';
import {
  InMemoryJoinLinkService,
  InMemoryNamespaceRepo,
  createTestScope,
  userCaller,
} from '../../../testing/index';
import { createJoinLink } from '../create-join-link';
import { listJoinLinks } from '../list-join-links';
import { redeemJoinLink } from '../redeem-join-link';
import { PreconditionFailedError } from '../../../errors';
import type {
  InviteNotificationService,
  InviteService,
  SeedInviteInput,
  SendActivationEmailInput,
  SendWorkspaceNotificationEmailInput,
} from '../../../services/invite-notification';

const adminRoles = new Map<string, 'owner' | 'admin' | 'member'>([['alpha', 'admin']]);

function recordingInviteService(pending = true): InviteService & {
  seedCalls: SeedInviteInput[];
} {
  const seedCalls: SeedInviteInput[] = [];
  return {
    seedCalls,
    async seedInvite(input) {
      seedCalls.push(input);
      return { uid: `uid-${input.email}`, isExisting: false };
    },
    async getUserEmail() {
      return null;
    },
    async isInvitePending() {
      return pending;
    },
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

describe('redeemJoinLink handler', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let joinLinkService: InMemoryJoinLinkService;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.seedNamespace({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Labs',
      createdAt: new Date().toISOString(),
    });
    auditRepo = new InMemoryAuditRepository();
    joinLinkService = new InMemoryJoinLinkService();
  });

  function adminScope() {
    return createTestScope({
      caller: userCaller('admin-1', ['alpha'], adminRoles),
      namespaceRepo,
      auditRepo,
      joinLinkService,
    });
  }

  /** No caller, as in production: the token is the authorization. */
  function publicScope(overrides: {
    inviteService?: InviteService;
    inviteNotificationService?: InviteNotificationService | null;
    userProfileRepo?: InMemoryUserProfileRepository;
    passwordAuthEnabled?: boolean;
  } = {}) {
    return createTestScope({
      namespaceRepo,
      auditRepo,
      joinLinkService,
      inviteService: overrides.inviteService ?? recordingInviteService(),
      inviteNotificationService: overrides.inviteNotificationService ?? recordingNotifier(),
      userProfileRepo: overrides.userProfileRepo ?? new InMemoryUserProfileRepository(),
      ...(overrides.passwordAuthEnabled !== undefined
        ? { passwordAuthEnabled: overrides.passwordAuthEnabled }
        : {}),
    });
  }

  async function mint(options: { maxUses?: number } = {}) {
    return createJoinLink(
      {
        namespaceHandle: 'alpha',
        expiresInDays: 7,
        ...(options.maxUses !== undefined ? { maxUses: options.maxUses } : {}),
      },
      adminScope(),
    );
  }

  it('seeds the account into the link’s workspace as a member, and consumes a use', async () => {
    const created = await mint({ maxUses: 5 });
    const inviteService = recordingInviteService();
    const scope = publicScope({ inviteService });

    const result = await redeemJoinLink(
      { token: created.token, email: '  Newbie@Example.Test ', displayName: 'Newbie' },
      scope,
    );

    expect(result).toEqual({
      ok: true,
      namespaceHandle: 'alpha',
      workspaceName: 'Alpha Labs',
      emailSent: true,
    });
    expect(inviteService.seedCalls).toEqual([
      {
        email: 'newbie@example.test',
        displayName: 'Newbie',
        workspaceHandle: 'alpha',
        // Always the plain seat, whatever the link (ADR-0021 §3).
        membership: 'member',
        roles: [],
        // The email came from a public form, held together by nothing but a
        // shared secret, so the seed may only create.
        vouchedByAdmin: false,
      },
    ]);

    const { links } = await listJoinLinks({ namespaceHandle: 'alpha' }, adminScope());
    expect(links[0]?.uses).toBe(1);
  });

  /**
   * ADR-0021 §4, the load-bearing decision: redeeming seeds an account and
   * sends the same activation email an admin invite sends. It never opens a
   * session, so a photograph of the link is not an account.
   */
  it('sends the activation email — the same one the admin invite path sends', async () => {
    const created = await mint();
    const notifier = recordingNotifier();
    const scope = publicScope({ inviteNotificationService: notifier });

    await redeemJoinLink({ token: created.token, email: 'newbie@example.test' }, scope);

    expect(notifier.activationCalls).toHaveLength(1);
    expect(notifier.activationCalls[0]?.toEmail).toBe('newbie@example.test');
    expect(notifier.activationCalls[0]?.workspaceHandle).toBe('alpha');
    // No inviter to name, so the workspace stands in — never "undefined invited you".
    expect(notifier.activationCalls[0]?.inviterName).toBe('Alpha Labs');
    expect(notifier.workspaceCalls).toHaveLength(0);
  });

  it('gates a pending joiner into the create-password flow only where passwords exist', async () => {
    const created = await mint();
    const userProfileRepo = new InMemoryUserProfileRepository();
    const setMustChangePassword = vi.spyOn(userProfileRepo, 'setMustChangePassword');

    await redeemJoinLink(
      { token: created.token, email: 'newbie@example.test' },
      publicScope({ userProfileRepo, passwordAuthEnabled: false }),
    );

    expect(setMustChangePassword).not.toHaveBeenCalled();
  });

  it('answers identically for an address that is already a member (no enumeration oracle)', async () => {
    const created = await mint({ maxUses: 5 });
    const existing: InviteService = {
      async seedInvite(input) {
        return { uid: `uid-${input.email}`, isExisting: true };
      },
      async getUserEmail() {
        return null;
      },
      async isInvitePending() {
        return false;
      },
    };

    const known = await redeemJoinLink(
      { token: created.token, email: 'already@example.test' },
      publicScope({ inviteService: existing }),
    );
    const stranger = await redeemJoinLink(
      { token: created.token, email: 'stranger@example.test' },
      publicScope(),
    );

    expect(known).toEqual(stranger);
  });

  /**
   * The redemption path must never vouch. `seedInvite` reads this flag to
   * decide whether it may rewrite an existing membership, stamp `invited_at` on
   * an account that already exists, or clear an auto-join tombstone — and the
   * email here is attacker-supplied. Passing `true` would let any link holder
   * demote a workspace owner and re-admit an allowlist-blocked account by
   * typing their addresses.
   */
  it('never vouches for the address it was handed', async () => {
    const created = await mint();
    const inviteService = recordingInviteService();

    await redeemJoinLink(
      { token: created.token, email: 'owner@example.test' },
      publicScope({ inviteService }),
    );

    expect(inviteService.seedCalls[0]?.vouchedByAdmin).toBe(false);
  });

  it('refuses once the use cap is reached, and stops consuming', async () => {
    const created = await mint({ maxUses: 1 });

    const first = await redeemJoinLink(
      { token: created.token, email: 'first@example.test' },
      publicScope(),
    );
    const second = await redeemJoinLink(
      { token: created.token, email: 'second@example.test' },
      publicScope(),
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: 'exhausted' });
    const { links } = await listJoinLinks({ namespaceHandle: 'alpha' }, adminScope());
    expect(links[0]?.uses).toBe(1);
  });

  it('does not seed anything for a token it rejects', async () => {
    const inviteService = recordingInviteService();

    const result = await redeemJoinLink(
      { token: 'not-a-real-token', email: 'mallory@example.test' },
      publicScope({ inviteService }),
    );

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(inviteService.seedCalls).toEqual([]);
    expect((await auditRepo.getByNamespace('alpha')).items).toEqual([]);
  });

  it('reports emailSent: false rather than failing when delivery throws', async () => {
    const created = await mint();
    const brokenNotifier: InviteNotificationService = {
      async sendActivationEmail() {
        throw new Error('mailgun is down');
      },
      async sendWorkspaceNotificationEmail() {
        throw new Error('mailgun is down');
      },
    };

    const result = await redeemJoinLink(
      { token: created.token, email: 'newbie@example.test' },
      publicScope({ inviteNotificationService: brokenNotifier }),
    );

    expect(result).toEqual({
      ok: true,
      namespaceHandle: 'alpha',
      workspaceName: 'Alpha Labs',
      emailSent: false,
    });
  });

  it('audits the redemption with the link id and never the token', async () => {
    const created = await mint();

    await redeemJoinLink({ token: created.token, email: 'newbie@example.test' }, publicScope());

    const events = (await auditRepo.getByNamespace('alpha')).items;
    const redemption = events.find((e) => e.action === 'invitation.link_redeemed');
    expect(redemption?.entityId).toBe(created.link.id);
    expect(JSON.stringify(redemption)).not.toContain(created.token);
  });

  // Same guard as `previewJoinLink`: the public route hands this a system-actor
  // scope, which is only safe while the handler ignores `scope.caller`.
  it('ignores scope.caller — the token is the authorization', async () => {
    const created = await mint({ maxUses: 5 });

    const asSystem = await redeemJoinLink(
      { token: created.token, email: 'a@example.test' },
      publicScope(),
    );
    const strangerScope = createTestScope({
      caller: userCaller('outsider-1', ['unrelated']),
      namespaceRepo,
      auditRepo,
      joinLinkService,
      inviteService: recordingInviteService(),
      inviteNotificationService: recordingNotifier(),
      userProfileRepo: new InMemoryUserProfileRepository(),
    });
    const asStranger = await redeemJoinLink(
      { token: created.token, email: 'b@example.test' },
      strangerScope,
    );

    expect(asSystem).toEqual(asStranger);
  });

  it('fails cleanly when the deployment has no join-link store', async () => {
    const scope = createTestScope({ namespaceRepo, auditRepo, joinLinkService: null });

    await expect(
      redeemJoinLink({ token: 'anything', email: 'a@b.test' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});
