import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level smoke. Handler behaviour (admin gate, email branching,
// audit emission) is covered at L2 in
// packages/platform-api/src/handlers/users/__tests__/invite-user.test.ts.
// This file proves the adapter wires schema + services + handler, and that
// 201 + the typed error envelope flow through.

const mockCreateInvitedUser = vi.fn();
const mockAddMember = vi.fn();
const mockGetNamespace = vi.fn();
const mockSendInviteEmail = vi.fn();
const mockSendWorkspaceEmail = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    namespaceRepo: {
      getNamespace: mockGetNamespace,
      addMember: mockAddMember,
      getMembers: vi.fn(),
      getMembershipsForUser: vi.fn().mockResolvedValue([]),
    },
    inviteService: {
      createInvitedUser: mockCreateInvitedUser,
      resetInvitePassword: vi.fn(),
      getUserEmail: vi.fn(),
      isInvitePending: vi.fn(),
    },
    inviteNotificationService: {
      sendInviteEmail: mockSendInviteEmail,
      sendWorkspaceNotificationEmail: mockSendWorkspaceEmail,
    },
    instanceRepo: { getById: vi.fn() },
    auditRepo: { append: mockAuditAppend },
    platformSettingsRepo: { get: vi.fn().mockResolvedValue(null) },
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
  return new NextRequest('http://localhost/api/users/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  email: 'newbie@example.test',
  namespaceHandle: 'alpha',
  role: 'member' as const,
};

describe('POST /api/users/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveCallerIdentity.mockResolvedValue(apiKeyCaller);
    mockCreateInvitedUser.mockResolvedValue({
      uid: 'uid-new',
      temporaryPassword: 'Mf-XYZ',
      isExisting: false,
    });
    mockGetNamespace.mockResolvedValue(null);
    mockAddMember.mockResolvedValue(undefined);
    mockSendInviteEmail.mockResolvedValue(undefined);
    mockSendWorkspaceEmail.mockResolvedValue(undefined);
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[HAPPY] returns 201 with the invite payload for an apiKey caller', async () => {
    const res = await POST(makePostRequest(validBody));
    const json = (await res.json()) as {
      uid: string;
      email: string;
      temporaryPassword: string;
      emailSent: boolean;
      isExisting: boolean;
    };

    expect(res.status).toBe(201);
    expect(json).toEqual({
      uid: 'uid-new',
      email: 'newbie@example.test',
      temporaryPassword: 'Mf-XYZ',
      emailSent: true,
      isExisting: false,
    });
    expect(mockCreateInvitedUser).toHaveBeenCalledWith('newbie@example.test', undefined);
    expect(mockAddMember).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ uid: 'uid-new', role: 'member' }),
    );
    expect(mockSendInviteEmail).toHaveBeenCalled();
  });

  it('[AUTHZ] non-admin user gets 403', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller('alpha', 'member'));

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(403);
    expect(mockCreateInvitedUser).not.toHaveBeenCalled();
  });

  it('[AUTHZ] owner/admin caller succeeds', async () => {
    mockResolveCallerIdentity.mockResolvedValue(memberCaller('alpha', 'admin'));

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(201);
  });

  it('[AUTH] unauthenticated request → 401', async () => {
    mockResolveCallerIdentity.mockResolvedValue(
      // The real resolver returns a NextResponse for unauthenticated requests;
      // simulate the same so the adapter short-circuits.
      new Response('Unauthorized', { status: 401 }) as never,
    );

    // The route adapter checks `callerOrResponse instanceof NextResponse`, so
    // return a NextResponse-shaped object from the mock.
    const { NextResponse } = await import('next/server');
    mockResolveCallerIdentity.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    const res = await POST(makePostRequest(validBody));

    expect(res.status).toBe(401);
    expect(mockCreateInvitedUser).not.toHaveBeenCalled();
  });

  it('[VALIDATION] 400 for an invalid email', async () => {
    const res = await POST(makePostRequest({ ...validBody, email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(mockCreateInvitedUser).not.toHaveBeenCalled();
  });

  it('[VALIDATION] 400 for a namespaceHandle that violates the regex', async () => {
    const res = await POST(makePostRequest({ ...validBody, namespaceHandle: 'Alpha_Space' }));

    expect(res.status).toBe(400);
    expect(mockCreateInvitedUser).not.toHaveBeenCalled();
  });

  it('[VALIDATION] 400 when the body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockCreateInvitedUser).not.toHaveBeenCalled();
  });
});
