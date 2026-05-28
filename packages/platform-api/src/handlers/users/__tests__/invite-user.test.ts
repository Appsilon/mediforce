import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import type {
  Namespace,
  NamespaceMember,
  NamespaceRepository,
} from '@mediforce/platform-core';
import { inviteUser } from '../invite-user.js';
import { ForbiddenError, PreconditionFailedError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import type {
  InviteNotificationService,
  InviteService,
  InvitedUser,
  SendInviteEmailInput,
  SendWorkspaceNotificationEmailInput,
} from '../../../services/invite-notification.js';

class InMemoryNamespaceRepository implements NamespaceRepository {
  readonly members = new Map<string, NamespaceMember[]>();
  readonly userOrganizations = new Map<string, string[]>();
  private readonly namespaces = new Map<string, Namespace>();

  setNamespace(namespace: Namespace): void {
    this.namespaces.set(namespace.handle, namespace);
  }

  async getNamespace(handle: string): Promise<Namespace | null> {
    return this.namespaces.get(handle) ?? null;
  }
  async createNamespace(): Promise<void> {
    /* not exercised */
  }
  async createNamespaceWithOwner(): Promise<void> {
    /* not exercised */
  }
  async updateNamespace(): Promise<void> {
    /* not exercised */
  }
  async getNamespacesByUser(): Promise<Namespace[]> {
    return [];
  }
  async addMember(handle: string, member: NamespaceMember): Promise<void> {
    const list = this.members.get(handle) ?? [];
    this.members.set(handle, [...list.filter((m) => m.uid !== member.uid), member]);
    const orgs = this.userOrganizations.get(member.uid) ?? [];
    if (!orgs.includes(handle)) {
      this.userOrganizations.set(member.uid, [...orgs, handle]);
    }
  }
  async removeMember(): Promise<void> {
    /* not exercised */
  }
  async removeMemberWithOrganizations(): Promise<void> {
    /* not exercised */
  }
  async setMemberRole(): Promise<void> {
    /* not exercised */
  }
  async deleteNamespaceCascade(): Promise<void> {
    /* not exercised */
  }
  async getMember(): Promise<NamespaceMember | null> {
    return null;
  }
  async getMembers(handle: string): Promise<NamespaceMember[]> {
    return this.members.get(handle) ?? [];
  }
  async getUserNamespaces(): Promise<Namespace[]> {
    return [];
  }
  async getMembershipsForUser(): Promise<readonly never[]> {
    return [];
  }
}

function inviteServiceReturning(result: InvitedUser): InviteService {
  return {
    createInvitedUser: vi.fn(async () => result),
    resetInvitePassword: vi.fn(async () => 'Mf-RESET'),
    getUserEmail: vi.fn(async () => null),
    isInvitePending: vi.fn(async () => true),
  };
}

function recordingNotifier(): InviteNotificationService & {
  sendInviteEmailCalls: SendInviteEmailInput[];
  sendWorkspaceCalls: SendWorkspaceNotificationEmailInput[];
} {
  const sendInviteEmailCalls: SendInviteEmailInput[] = [];
  const sendWorkspaceCalls: SendWorkspaceNotificationEmailInput[] = [];
  return {
    sendInviteEmailCalls,
    sendWorkspaceCalls,
    async sendInviteEmail(input) {
      sendInviteEmailCalls.push(input);
    },
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
  let namespaceRepo: InMemoryNamespaceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepository();
    auditRepo = new InMemoryAuditRepository();
  });

  it('invites a brand-new user for an apiKey caller and sends the invite email', async () => {
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
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
      temporaryPassword: 'Mf-XYZ',
      emailSent: true,
      isExisting: false,
    });
    expect(notifier.sendInviteEmailCalls).toEqual([
      { toEmail: 'newbie@example.test', temporaryPassword: 'Mf-XYZ' },
    ]);
    expect(notifier.sendWorkspaceCalls).toHaveLength(0);
    expect(namespaceRepo.members.get('alpha')).toEqual([
      expect.objectContaining({ uid: 'uid-new', role: 'member' }),
    ]);
    expect(namespaceRepo.userOrganizations.get('uid-new')).toEqual(['alpha']);
  });

  it('lower-cases + trims the email and forwards displayName', async () => {
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
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

    expect(inviteService.createInvitedUser).toHaveBeenCalledWith(
      'newbie@example.test',
      'Newbie',
    );
    expect(namespaceRepo.members.get('alpha')?.[0]).toMatchObject({
      uid: 'uid-new',
      displayName: 'Newbie',
    });
  });

  it('proceeds for an owner caller of the namespace', async () => {
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
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
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
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
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      caller: userCaller('u-member', ['alpha'], memberRoles),
    });

    await expect(inviteUser(baseInput, scope)).rejects.toBeInstanceOf(ForbiddenError);
    expect(namespaceRepo.members.get('alpha')).toBeUndefined();
  });

  it('throws ForbiddenError for a caller not in the namespace', async () => {
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
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

  it('sends the workspace-notification email for an existing user', async () => {
    namespaceRepo.setNamespace({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Workspace',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const inviteService = inviteServiceReturning({
      uid: 'uid-existing',
      temporaryPassword: '',
      isExisting: true,
    });
    const notifier = recordingNotifier();
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: notifier,
    });

    const result = await inviteUser({ ...baseInput, inviterName: 'Marek' }, scope);

    expect(result.isExisting).toBe(true);
    expect(result.temporaryPassword).toBe('');
    expect(notifier.sendInviteEmailCalls).toHaveLength(0);
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
    const inviteService = inviteServiceReturning({
      uid: 'uid-existing',
      temporaryPassword: '',
      isExisting: true,
    });
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
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
    const notifier: InviteNotificationService = {
      async sendInviteEmail() {
        throw new Error('mailgun down');
      },
      async sendWorkspaceNotificationEmail() {
        /* not exercised */
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
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
    const scope = createTestScope({
      namespaceRepo,
      auditRepo,
      inviteService,
      inviteNotificationService: null,
    });

    const result = await inviteUser(baseInput, scope);

    expect(result.emailSent).toBe(false);
    expect(result.uid).toBe('uid-new');
    // Member still recorded.
    expect(namespaceRepo.members.get('alpha')).toHaveLength(1);
  });

  it('writes an invitation.created audit event attributed to the caller', async () => {
    const inviteService = inviteServiceReturning({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
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
