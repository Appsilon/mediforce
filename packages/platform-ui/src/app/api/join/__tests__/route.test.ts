import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Route-level coverage for the PUBLIC half of join links (ADR-0021).
 *
 * These two routes carry guards the authenticated adapter would otherwise
 * supply, so they are tested here rather than only at L2: they are reachable
 * with no credentials (`proxy.ts` exempts `/api/join/*`), redemption sends
 * mail, and the CSRF + rate-limit guards are the whole reason that exemption is
 * safe. Handler semantics live in
 * packages/platform-api/src/handlers/join-links/__tests__/.
 */

const mockGetNamespace = vi.fn();
const mockSeedInvite = vi.fn();
const mockSendActivationEmail = vi.fn();
const mockAuditAppend = vi.fn();

vi.mock('@/lib/platform-services', async () => {
  const { mockPlatformServices } = await import('@/test/platform-services-mock');
  const { InMemoryJoinLinkService } = await import('@mediforce/platform-api/testing');
  const joinLinkService = new InMemoryJoinLinkService();
  return {
    getPlatformServices: () =>
      mockPlatformServices({
        namespaceRepo: {
          getNamespace: mockGetNamespace,
          getMembershipsForUser: vi.fn().mockResolvedValue([]),
        },
        joinLinkService,
        inviteService: {
          seedInvite: mockSeedInvite,
          getUserEmail: vi.fn(),
          isInvitePending: vi.fn().mockResolvedValue(true),
        },
        inviteNotificationService: {
          sendActivationEmail: mockSendActivationEmail,
          sendWorkspaceNotificationEmail: vi.fn(),
        },
        userProfileRepo: { setMustChangePassword: vi.fn() },
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
  };
});

import { NextRequest } from 'next/server';
import { POST as PREVIEW } from '../preview/route';
import { POST as REDEEM } from '../redeem/route';
import { __resetJoinRateLimitsForTests } from '../shared';
import { publicJoinScope } from '@/lib/join-link-scope';
import { createJoinLink } from '@mediforce/platform-api/handlers';

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Mints through the real handler on the same in-memory store the routes read. */
async function mintToken(options: { maxUses?: number } = {}): Promise<string> {
  const { token } = await createJoinLink(
    {
      namespaceHandle: 'alpha',
      membership: 'member',
      expiresInDays: 7,
      ...(options.maxUses !== undefined ? { maxUses: options.maxUses } : {}),
    },
    publicJoinScope(),
  );
  return token;
}

describe('public /api/join routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetJoinRateLimitsForTests();
    mockGetNamespace.mockResolvedValue({
      handle: 'alpha',
      type: 'organization',
      displayName: 'Alpha Labs',
    });
    mockSeedInvite.mockResolvedValue({ uid: 'uid-joiner', isExisting: false });
    mockSendActivationEmail.mockResolvedValue(undefined);
    mockAuditAppend.mockResolvedValue(undefined);
  });

  it('[HAPPY] preview names the workspace without a session', async () => {
    const token = await mintToken();

    const res = await PREVIEW(jsonPost('/api/join/preview', { token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      namespaceHandle: 'alpha',
      workspaceName: 'Alpha Labs',
      membership: 'member',
    });
  });

  it('[HAPPY] redeem seeds the account and sends the activation email', async () => {
    const token = await mintToken();

    const res = await REDEEM(
      jsonPost('/api/join/redeem', { token, email: 'newbie@example.test' }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      namespaceHandle: 'alpha',
      workspaceName: 'Alpha Labs',
      emailSent: true,
    });
    expect(mockSeedInvite).toHaveBeenCalledWith({
      email: 'newbie@example.test',
      workspaceHandle: 'alpha',
      membership: 'member',
      roles: [],
    });
    expect(mockSendActivationEmail).toHaveBeenCalledTimes(1);
  });

  it('[CSRF] refuses a form-encoded post — only JSON reaches the handler', async () => {
    const token = await mintToken();
    const res = await REDEEM(
      new NextRequest('http://localhost/api/join/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${token}&email=mallory@example.test`,
      }),
    );

    expect(res.status).toBe(415);
    expect(mockSeedInvite).not.toHaveBeenCalled();
  });

  it('[RATE-LIMIT] caps redemption attempts per address+token and never mails past the cap', async () => {
    const token = await mintToken({ maxUses: 100 });
    const headers = { 'x-forwarded-for': '203.0.113.9' };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ok = await REDEEM(
        jsonPost('/api/join/redeem', { token, email: `a${attempt}@example.test` }, headers),
      );
      expect(ok.status).toBe(200);
    }

    const blocked = await REDEEM(
      jsonPost('/api/join/redeem', { token, email: 'sixth@example.test' }, headers),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    expect(mockSendActivationEmail).toHaveBeenCalledTimes(5);
  });

  it('[VALIDATION] a malformed preview body reads as an unusable token, not a 400', async () => {
    const res = await PREVIEW(jsonPost('/api/join/preview', { nope: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
  });

  it('[VALIDATION] redeem rejects a body with no email before spending a use', async () => {
    const token = await mintToken({ maxUses: 1 });

    const res = await REDEEM(jsonPost('/api/join/redeem', { token }));

    expect(res.status).toBe(400);
    expect(mockSeedInvite).not.toHaveBeenCalled();
    // The seat survives a typo: the cap is spent by redemptions, not attempts.
    const still = await REDEEM(jsonPost('/api/join/redeem', { token, email: 'ok@example.test' }));
    expect(((await still.json()) as { ok: boolean }).ok).toBe(true);
  });
});
