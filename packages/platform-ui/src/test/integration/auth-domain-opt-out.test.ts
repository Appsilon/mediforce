import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
}));

import { buildAuthConfig } from '../../auth';
import { validateEnv } from '../../instrumentation-node';

/**
 * ADR-0002 §4a opt-out: `ALLOWED_EMAIL_DOMAINS='*'` deliberately disables the
 * email-domain restriction so any Google/OIDC account can sign in. This proves
 * the whole decision path (auth.ts signIn callback reading the env) honours the
 * sentinel, and that the boot guard accepts it with a WARN yet still fails an
 * empty allowlist.
 */

function callSignIn(email: string): boolean | Promise<boolean> {
  const signIn = buildAuthConfig().callbacks?.signIn;
  if (!signIn) throw new Error('signIn callback is not configured');
  return signIn({ user: { id: 'u1', email, emailVerified: null } } as Parameters<typeof signIn>[0]);
}

describe('signIn email-domain gate', () => {
  afterEach(() => {
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  it('accepts an out-of-domain Google sign-in when the "*" sentinel is set', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = '*';
    expect(await callSignIn('mallory@evil.com')).toBe(true);
  });

  it('rejects an out-of-domain sign-in when a real domain list is set', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'appsilon.com';
    expect(await callSignIn('mallory@evil.com')).toBe(false);
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
