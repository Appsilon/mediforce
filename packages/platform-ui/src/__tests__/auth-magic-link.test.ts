import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit coverage for the Email provider in `buildProviders` — (1) when it is
 * registered at all (registration follows email configuration, NOT the
 * `ENABLE_MAGIC_LINK` login-page display flag, so invite-activation links keep
 * working with login magic-link off), and (2) the `sendVerificationRequest`
 * that wires the account/domain gate to the email builder to the resolved
 * sender. Auth.js's own token + session-mint flow is the library's concern;
 * this pins OUR code: who gets a link and who silently does not
 * (anti-enumeration + no self-registration).
 */

// Importing `../auth` pulls the real Auth.js runtime graph (`next-auth` →
// `next/server`), which vitest's node resolver cannot load. `buildProviders`
// needs none of it — it only assembles provider objects — so stub the runtime
// pieces auth.ts imports at module load.
vi.mock('next-auth', () => ({
  default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('next-auth/providers/google', () => ({
  default: () => ({ id: 'google', type: 'oauth', name: 'Google' }),
}));
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));

const mockFindPasswordCredentialByEmail = vi.fn();
const mockSend = vi.fn(async () => ({ messageId: 'test-message-id' }));

interface ResolvedEmailStub {
  send: typeof mockSend;
  from: string;
  senderName: string;
  provider: 'file';
}

const resolvedEmailStub: ResolvedEmailStub = {
  send: mockSend,
  from: 'no-reply@example.com',
  senderName: 'Mediforce',
  provider: 'file',
};

// Controls whether email is configured for a given test. Non-null => the Email
// provider is registered; null => email disabled, no provider.
let mockResolvedEmail: ResolvedEmailStub | null = resolvedEmailStub;

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  authUsers: {},
  authAccounts: {},
  authSessions: {},
  authVerificationTokens: {},
  getUserRoles: vi.fn(async () => []),
  recordSignIn: vi.fn(),
  findPasswordCredentialByEmail: (...args: unknown[]) => mockFindPasswordCredentialByEmail(...args),
  resolveEmailSenderFromEnv: () => mockResolvedEmail,
}));

import { buildProviders } from '../auth';

interface EmailProviderShape {
  id?: string;
  sendVerificationRequest?: (args: { identifier: string; url: string }) => Promise<void>;
}

const MAGIC_URL = 'https://app.example.com/api/auth/callback/email?token=abc123';

function emailProvider(): (args: { identifier: string; url: string }) => Promise<void> {
  const provider = buildProviders({} as never).find(
    (candidate) => (candidate as EmailProviderShape).id === 'email',
  ) as EmailProviderShape | undefined;
  if (provider?.sendVerificationRequest === undefined) {
    throw new Error('email provider (or its sendVerificationRequest) was not built');
  }
  return provider.sendVerificationRequest;
}

function emailProviderBuilt(): boolean {
  return buildProviders({} as never).some(
    (candidate) => (candidate as EmailProviderShape).id === 'email',
  );
}

describe('buildProviders Email provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvedEmail = resolvedEmailStub;
    process.env.ALLOWED_EMAIL_DOMAINS = 'example.com';
    delete process.env.ENABLE_MAGIC_LINK;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.OIDC_ISSUER;
  });

  afterEach(() => {
    delete process.env.ENABLE_MAGIC_LINK;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  it('registers the Email provider when email is configured, regardless of ENABLE_MAGIC_LINK', () => {
    mockResolvedEmail = resolvedEmailStub;

    delete process.env.ENABLE_MAGIC_LINK;
    expect(emailProviderBuilt()).toBe(true);

    process.env.ENABLE_MAGIC_LINK = 'true';
    expect(emailProviderBuilt()).toBe(true);
  });

  it('does not register the Email provider when email is disabled (resolver returns null)', () => {
    mockResolvedEmail = null;

    // Even with the login-page flag on, no email sender means no provider.
    process.env.ENABLE_MAGIC_LINK = 'true';
    expect(emailProviderBuilt()).toBe(false);
  });
});

describe('buildProviders magic-link sendVerificationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvedEmail = resolvedEmailStub;
    process.env.ALLOWED_EMAIL_DOMAINS = 'example.com';
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.OIDC_ISSUER;
  });

  afterEach(() => {
    delete process.env.ENABLE_MAGIC_LINK;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  it('sends the link to an existing user on an allowlisted domain', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      image: null,
      passwordHash: null,
    });

    await emailProvider()({ identifier: 'alice@example.com', url: MAGIC_URL });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [params] = mockSend.mock.calls[0] as [{ to: string[]; subject: string; text: string; html?: string }];
    expect(params.to).toEqual(['alice@example.com']);
    expect(params.subject.length).toBeGreaterThan(0);
    expect(params.text).toContain(MAGIC_URL);
    expect(params.html ?? '').toContain(MAGIC_URL);
  });

  it('does not send (and does not throw) when the user does not exist', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue(null);

    await expect(
      emailProvider()({ identifier: 'nobody@example.com', url: MAGIC_URL }),
    ).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send when the domain is not allowlisted', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue({
      id: 'user-2',
      email: 'mallory@evil.com',
      name: null,
      image: null,
      passwordHash: null,
    });

    await emailProvider()({ identifier: 'mallory@evil.com', url: MAGIC_URL });

    expect(mockSend).not.toHaveBeenCalled();
  });
});
