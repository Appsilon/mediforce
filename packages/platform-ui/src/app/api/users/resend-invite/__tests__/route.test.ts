import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke. Handler behaviour (admin gate, pending-check branching,
// audit emission) is covered at L2 in
// packages/platform-api/src/handlers/users/__tests__/resend-invite.test.ts.
// This file proves the adapter wires schema + services + handler, and that
// 200 + the typed error envelope flow through.

const mockResetInvitePassword = vi.fn();
const mockGetUserEmail = vi.fn();
const mockIsInvitePending = vi.fn();
const mockSendInviteEmail = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: {
      getNamespace: vi.fn(),
      addMember: vi.fn(),
      getMembers: vi.fn(),
      getMembershipsForUser: vi.fn().mockResolvedValue([]),
    },
    inviteService: {
      createInvitedUser: vi.fn(),
      resetInvitePassword: mockResetInvitePassword,
      getUserEmail: mockGetUserEmail,
      isInvitePending: mockIsInvitePending,
    },
    inviteNotificationService: {
      sendInviteEmail: mockSendInviteEmail,
      sendWorkspaceNotificationEmail: vi.fn(),
    },
    instanceRepo: { getById: vi.fn() },
    auditRepo: { append: mockAuditAppend },
    toolCatalogRepo: {},
    oauthProviderRepo: {},
    agentOAuthTokenRepo: {},
    modelRegistryRepo: {},
    secretsRepo: {},
    namespaceSecretsRepo: {},
    userDirectory: null,
  }),
  getAppBaseUrl: () => 'http://localhost:3000',
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { POST } from '../route';

const apiKeyCaller = { kind: 'apiKey' as const, isSystemActor: true as const };

function memberCaller(handle: string, role: 'owner' | 'admin' | 'member' = 'member') {
  return {
    kind: 'user' as const,
    uid: 'uid-caller',
    namespaces: new Set([handle]),
    namespaceRoles: new Map([[handle, role]]),
    isSystemActor: false as const,
  };
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/users/resend-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  uid: 'uid-target',
  namespaceHandle: 'alpha',
};

describe('POST /api/users/resend-invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);
    mockGetUserEmail.mockResolvedValue('pending@example.test');
    mockIsInvitePending.mockResolvedValue(true);
    mockResetInvitePassword.mockResolvedValue('Mf-RESET');
    mockSendInviteEmail.mockResolvedValue(undefined);
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[HAPPY] returns 200 with the resend payload for an apiKey caller', async () => {
    const res = await POST(makePostRequest(validBody));
    const json = (await res.json()) as {
      uid: string;
      email: string;
      temporaryPassword: string;
      emailSent: boolean;
    };

    expect(res.status).toBe(200);
    expect(json).toEqual({
      uid: 'uid-target',
      email: 'pending@example.test',
      temporaryPassword: 'Mf-RESET',
      emailSent: true,
    });
    expect(mockResetInvitePassword).toHaveBeenCalledWith('uid-target');
    expect(mockSendInviteEmail).toHaveBeenCalledWith({
      toEmail: 'pending@example.test',
      temporaryPassword: 'Mf-RESET',
    });
  });

  it('[AUTH] unauthenticated request → 401', async () => {
    const { NextResponse } = await import('next/server');
    mockResolveCallerIdentity.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockResetInvitePassword).not.toHaveBeenCalled();
  });

  it('[AUTHZ] non-admin user gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller('alpha', 'member'));

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(403);
    expect(mockResetInvitePassword).not.toHaveBeenCalled();
  });

  it('[VALIDATION] 400 for an empty uid', async () => {
    const res = await POST(makePostRequest({ ...validBody, uid: '' }));

    expect(res.status).toBe(400);
    expect(mockResetInvitePassword).not.toHaveBeenCalled();
  });

  it('[PRECONDITION] 409 when the invite is no longer pending', async () => {
    mockIsInvitePending.mockResolvedValueOnce(false);

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(409);
    expect(mockResetInvitePassword).not.toHaveBeenCalled();
  });
});
