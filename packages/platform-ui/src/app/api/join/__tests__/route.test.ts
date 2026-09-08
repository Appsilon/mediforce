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
      // Nobody vouched for this address: it was typed into a public form by
      // whoever holds the link, so the seed may only create.
      vouchedByAdmin: false,
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

  it('[RATE-LIMIT] caps redemptions per token and never mails past the cap', async () => {
    const token = await mintToken({ maxUses: 200 });

    // Each attendee gets their own address so only the per-token ceiling is in
    // play — it is the budget nothing a caller sends can move, and the one that
    // stops a leaked link from becoming a mail relay.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const ok = await REDEEM(
        jsonPost(
          '/api/join/redeem',
          { token, email: `a${attempt}@example.test` },
          { 'x-forwarded-for': `203.0.113.${attempt}` },
        ),
      );
      expect(ok.status).toBe(200);
    }

    const blocked = await REDEEM(
      jsonPost(
        '/api/join/redeem',
        { token, email: 'past-the-cap@example.test' },
        { 'x-forwarded-for': '198.51.100.7' },
      ),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
    expect(mockSendActivationEmail).toHaveBeenCalledTimes(60);
  });

  it('[RATE-LIMIT] a room sharing one NAT address redeems the same link past the old five-attempt cap', async () => {
    const token = await mintToken({ maxUses: 200 });
    // The scenario the feature exists for: a workshop behind one conference
    // NAT, so every attendee presents the same address and the same token. A
    // budget keyed on that pair treats the whole room as one attendee.
    const headers = { 'x-forwarded-for': '203.0.113.9' };

    for (let attendee = 0; attendee < 30; attendee += 1) {
      const ok = await REDEEM(
        jsonPost('/api/join/redeem', { token, email: `seat${attendee}@example.test` }, headers),
      );
      expect(ok.status).toBe(200);
    }

    expect(mockSendActivationEmail).toHaveBeenCalledTimes(30);
  });

  it('[RATE-LIMIT] rotating the token does not buy a fresh budget', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.9' };

    // Every key that contains the token hash is a key the caller picks. A
    // script sending a fresh invalid token per request would reset such a
    // budget every time and charge the Postgres claim without bound, so the
    // address budget deliberately ignores the token.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const res = await REDEEM(
        jsonPost(
          '/api/join/redeem',
          { token: `bogus-${attempt}`, email: 'x@example.test' },
          headers,
        ),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, reason: 'not_found' });
    }

    const blocked = await REDEEM(
      jsonPost('/api/join/redeem', { token: 'bogus-120', email: 'x@example.test' }, headers),
    );

    expect(blocked.status).toBe(429);
    expect(mockSeedInvite).not.toHaveBeenCalled();
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
