import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// auth.ts wires NextAuth (which pulls in `next/server`) at module load; stub the
// NextAuth surface so the signIn decision path imports cleanly under the unit
// runner. buildAuthConfig itself does not need the real library.
vi.mock('next-auth', () => ({
  default: () => ({ auth: {}, handlers: {}, signIn: () => {}, signOut: () => {} }),
}));
vi.mock('next-auth/providers/google', () => ({ default: () => ({ id: 'google', type: 'oauth' }) }));
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));

// The second term of the ADR-0021 §5 gate: `auth_users.invited_at`, i.e. did an
// admin deliberately seed this account. Default `false` — which covers both a
// stranger and a self-registered account, the distinction the column exists to
// draw — so the allowlist alone decides unless a test says otherwise.
const mockAuthUserWasInvited = vi.fn(async () => false);

// auth.ts opens a Postgres client at module load; stub the infra layer so the
// signIn decision path can be exercised without a database.
vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  authUsers: {},
  authAccounts: {},
  authSessions: {},
  authVerificationTokens: {},
  getUserRoles: vi.fn(async () => []),
  recordSignIn: vi.fn(async () => {}),
  // auth.ts registers the Email provider whenever email is configured; null =
  // no email → no Email provider, which is irrelevant to the domain-opt-out test.
  resolveEmailSenderFromEnv: () => null,
  authUserWasInvited: (...args: unknown[]) => mockAuthUserWasInvited(...args),
}));

import { buildAuthConfig } from '../../auth';
import { validateEnv } from '../../instrumentation-node';

/**
 * Two things about the `signIn` gate, which ADR-0021 §5 made two-term.
 *
 * ADR-0002 §4a opt-out: `ALLOWED_EMAIL_DOMAINS='*'` deliberately disables the
 * email-domain restriction so any Google/OIDC account can sign in. This proves
 * the whole decision path (auth.ts signIn callback reading the env) honours the
 * sentinel, and that the boot guard accepts it with a WARN yet still fails an
 * empty allowlist.
 *
 * ADR-0021 §5: an address an admin deliberately seeded — an invite, or a
 * redeemed join link — is admitted whatever its domain. Before this, such an
 * invite produced an account that every route rejected. The second term is
 * `auth_users.invited_at` and NOT "a row exists", so the allowlist keeps its
 * other job: dropping a domain still evicts everyone who self-registered at it.
 */

function callSignIn(email: string): boolean | Promise<boolean> {
  const signIn = buildAuthConfig().callbacks?.signIn;
  if (!signIn) throw new Error('signIn callback is not configured');
  return signIn({ user: { id: 'u1', email, emailVerified: null } } as Parameters<typeof signIn>[0]);
}

describe('signIn email-domain gate', () => {
  beforeEach(() => {
    mockAuthUserWasInvited.mockClear();
    mockAuthUserWasInvited.mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  it('accepts an out-of-domain Google sign-in when the "*" sentinel is set', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = '*';
    expect(await callSignIn('mallory@evil.com')).toBe(true);
  });

  it('rejects an out-of-domain sign-in by an address with no account', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'appsilon.com';
    expect(await callSignIn('mallory@evil.com')).toBe(false);
  });

  it('admits an out-of-domain address that an admin deliberately seeded (ADR-0021 §5)', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'appsilon.com';
    mockAuthUserWasInvited.mockResolvedValue(true);
    expect(await callSignIn('alice@external.test')).toBe(true);
  });

  /**
   * The regression the `invited_at` column exists to prevent. The staging
   * runbook records `ALLOWED_EMAIL_DOMAINS=appsilon.com` deliberately blocking
   * two migrated accounts by name, so dropping a domain has to keep evicting
   * the people at it. A bare "an `auth_users` row exists" second term — which
   * is what ADR-0021 §5's own text proposed — would re-admit exactly those,
   * because the Auth.js adapter writes that row for every self-registered user.
   */
  it('still rejects an out-of-domain account that merely exists', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'appsilon.com';
    mockAuthUserWasInvited.mockResolvedValue(false);
    expect(await callSignIn('fylyps@gmail.com')).toBe(false);
  });

  it('does not need the account lookup when the domain is allowlisted', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'appsilon.com';
    expect(await callSignIn('bob@appsilon.com')).toBe(true);
    expect(mockAuthUserWasInvited).not.toHaveBeenCalled();
  });
});

describe('validateEnv boot guard for the opt-out sentinel', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Isolate the allowlist check: satisfy the other always-on requirements so
    // only ALLOWED_EMAIL_DOMAINS can push an error.
    process.env.DATABASE_URL = 'postgresql://mediforce:mediforce@localhost:5432/mediforce';
    process.env.MEDIFORCE_DISABLE_EMAIL = 'true';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.MEDIFORCE_DISABLE_EMAIL;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    vi.restoreAllMocks();
  });

  it('boots with a WARN when the sentinel disables the restriction', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = '*';

    validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toMatch(/ALLOWED_EMAIL_DOMAINS/);
    expect(warned.toLowerCase()).toContain('disabled');
  });

  it('still fails boot when OAuth is on and the allowlist is empty', () => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;

    expect(() => validateEnv()).toThrow('process.exit called');
  });
});
