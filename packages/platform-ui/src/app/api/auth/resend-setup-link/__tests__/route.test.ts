import { describe, it, expect, vi, beforeEach } from 'vitest';

// Public self-service "resend my setup link" route. Anti-enumeration is the
// core contract: every outcome (send, unknown email, active user, wrong domain,
// bad body) must return the identical generic 200 body, and only a
// pending + allowlisted invitee triggers an activation email.

const mockFindPasswordCredentialByEmail = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  findPasswordCredentialByEmail: (...args: unknown[]) =>
    mockFindPasswordCredentialByEmail(...args),
}));

const mockIsInvitePending = vi.fn();
const mockSetMustChangePassword = vi.fn();
const mockSendActivationEmail = vi.fn();
const mockPlatformSettingsGet = vi.fn();

let inviteNotificationService: { sendActivationEmail: typeof mockSendActivationEmail } | null = {
  sendActivationEmail: mockSendActivationEmail,
};
let passwordAuthEnabled = true;

vi.mock('@/lib/platform-services', async () => {
  const { mockPlatformServices } = await import('@/test/platform-services-mock');
  return {
    getPlatformServices: () =>
      mockPlatformServices({
        inviteService: { isInvitePending: mockIsInvitePending },
        userProfileRepo: { setMustChangePassword: mockSetMustChangePassword },
        platformSettingsRepo: { get: mockPlatformSettingsGet },
        inviteNotificationService,
        // Explicit on purpose: this suite drives both sides of the flag.
        passwordAuthEnabled,
      }),
  };
});

import { POST } from '../route';

function makeJsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/resend-setup-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const pendingUser = {
  id: 'uid-pending',
  email: 'pending@example.test',
  name: 'Pending',
  image: null,
  passwordHash: null,
};

describe('POST /api/auth/resend-setup-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    inviteNotificationService = { sendActivationEmail: mockSendActivationEmail };
    passwordAuthEnabled = true;
    mockFindPasswordCredentialByEmail.mockResolvedValue(pendingUser);
    mockIsInvitePending.mockResolvedValue(true);
    mockSetMustChangePassword.mockResolvedValue(undefined);
    mockSendActivationEmail.mockResolvedValue(undefined);
    mockPlatformSettingsGet.mockResolvedValue(null);
  });

  it('[HAPPY] pending + allowlisted → sends activation email with only toEmail and flags must-change-password', async () => {
    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSetMustChangePassword).toHaveBeenCalledWith('uid-pending', true);
    expect(mockSendActivationEmail).toHaveBeenCalledWith({
      toEmail: 'pending@example.test',
      passwordSetupEnabled: true,
    });
  });

  it('[BASEURL] passes the configured platform.baseUrl (normalized) to the activation email', async () => {
    mockPlatformSettingsGet.mockResolvedValue('https://phuse.mediforce.ai/');

    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(mockSendActivationEmail).toHaveBeenCalledWith({
      toEmail: 'pending@example.test',
      baseUrl: 'https://phuse.mediforce.ai',
      passwordSetupEnabled: true,
    });
  });

  it('[PASSWORD-OFF] still delivers the sign-in link but arms no create-password gate', async () => {
    passwordAuthEnabled = false;

    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(mockSetMustChangePassword).not.toHaveBeenCalled();
    // The link still works — the copy and its landing page just stop promising
    // a password this deployment cannot set.
    expect(mockSendActivationEmail).toHaveBeenCalledWith({
      toEmail: 'pending@example.test',
      passwordSetupEnabled: false,
    });
  });

  it('[ENUM] unknown email → no send, same generic 200', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue(null);

    const res = await POST(makeJsonRequest({ email: 'nobody@example.test' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendActivationEmail).not.toHaveBeenCalled();
    expect(mockSetMustChangePassword).not.toHaveBeenCalled();
  });

  it('[ENUM] active (non-pending) user → no send, same generic 200', async () => {
    mockIsInvitePending.mockResolvedValue(false);

    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendActivationEmail).not.toHaveBeenCalled();
    expect(mockSetMustChangePassword).not.toHaveBeenCalled();
  });

  it('[ENUM] out-of-allowlist domain → no send, same generic 200', async () => {
    vi.stubEnv('ALLOWED_EMAIL_DOMAINS', 'allowed.test');

    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendActivationEmail).not.toHaveBeenCalled();
    expect(mockSetMustChangePassword).not.toHaveBeenCalled();
  });

  it('[ENUM] send and no-send responses are byte-identical', async () => {
    const sendRes = await POST(makeJsonRequest({ email: 'pending@example.test' }));
    mockFindPasswordCredentialByEmail.mockResolvedValue(null);
    const noSendRes = await POST(makeJsonRequest({ email: 'nobody@example.test' }));

    expect(sendRes.status).toBe(noSendRes.status);
    expect(await sendRes.text()).toEqual(await noSendRes.text());
  });

  it('[VALIDATION] invalid email still returns the generic 200 (no leak)', async () => {
    const res = await POST(makeJsonRequest({ email: 'not-an-email' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFindPasswordCredentialByEmail).not.toHaveBeenCalled();
    expect(mockSendActivationEmail).not.toHaveBeenCalled();
  });

  it('[GUARD] non-JSON content-type → 415', async () => {
    const req = new Request('http://localhost/api/auth/resend-setup-link', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'email=pending@example.test',
    });

    const res = await POST(req);

    expect(res.status).toBe(415);
    expect(mockSendActivationEmail).not.toHaveBeenCalled();
  });

  it('[RESILIENCE] email delivery failure still returns generic 200', async () => {
    mockSendActivationEmail.mockRejectedValue(new Error('smtp down'));

    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('[EMAIL-OFF] no notification service configured → no send, generic 200', async () => {
    inviteNotificationService = null;

    const res = await POST(makeJsonRequest({ email: 'pending@example.test' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockSendActivationEmail).not.toHaveBeenCalled();
  });
});
