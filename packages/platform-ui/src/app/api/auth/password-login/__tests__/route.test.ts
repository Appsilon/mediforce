import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashSync } from 'bcryptjs';

const mockFindPasswordCredentialByEmail = vi.fn();
// ADR-0021 §5's second term: `auth_users.invited_at`. Default `false` = a
// self-registered account, so the allowlist alone decides unless a test says
// this address was deliberately seeded.
const mockAuthUserWasInvited = vi.fn(async () => false);
const mockCreateDatabaseSession = vi.fn();
const mockRecordSignIn = vi.fn();
const mockRecordSignInAuditEvent = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  findPasswordCredentialByEmail: (...args: unknown[]) => mockFindPasswordCredentialByEmail(...args),
  authUserWasInvited: (...args: unknown[]) => mockAuthUserWasInvited(...args),
  createDatabaseSession: (...args: unknown[]) => mockCreateDatabaseSession(...args),
  recordSignIn: (...args: unknown[]) => mockRecordSignIn(...args),
  recordSignInAuditEvent: (...args: unknown[]) => mockRecordSignInAuditEvent(...args),
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000,
}));

import { GET, POST } from '../route';

const PASSWORD = 'correct-horse-battery';
const PASSWORD_HASH = hashSync(PASSWORD, 4);

function loginRequest(body: unknown, url = 'http://localhost/api/auth/password-login'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/auth/password-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_PASSWORD_AUTH = 'true';
    delete process.env.ALLOWED_EMAIL_DOMAINS;
    mockAuthUserWasInvited.mockResolvedValue(false);
    mockFindPasswordCredentialByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      image: null,
      passwordHash: PASSWORD_HASH,
    });
    // Route only fires this and chains `.catch()` — a bare vi.fn() resolves
    // to undefined by default, which has no `.catch`.
    mockRecordSignInAuditEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.ENABLE_PASSWORD_AUTH;
    delete process.env.ALLOWED_EMAIL_DOMAINS;
  });

  it('signs in with a correct password and sets the session cookie to the session token', async () => {
    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(200);
    expect(mockCreateDatabaseSession).toHaveBeenCalledTimes(1);
    const [, session] = mockCreateDatabaseSession.mock.calls[0] as [unknown, { sessionToken: string; userId: string }];
    expect(session.userId).toBe('user-1');

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`authjs.session-token=${session.sessionToken}`);
    expect(cookie).toContain('HttpOnly');
    // Feeds the member list's "last seen" column.
    expect(mockRecordSignIn).toHaveBeenCalledWith({}, 'user-1');
    // Feeds the Users tab activity table (Monitoring → Users).
    expect(mockRecordSignInAuditEvent).toHaveBeenCalledWith({}, {
      uid: 'user-1',
      method: { kind: 'password', ipAddress: null, userAgent: null },
    });
  });

  it('captures the client IP and user-agent on the sign-in audit event', async () => {
    const request = new Request('http://localhost/api/auth/password-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.5, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 (Test)',
      },
      body: JSON.stringify({ email: 'alice@example.com', password: PASSWORD }),
    });

    await POST(request);

    expect(mockRecordSignInAuditEvent).toHaveBeenCalledWith({}, {
      uid: 'user-1',
      method: { kind: 'password', ipAddress: '203.0.113.5', userAgent: 'Mozilla/5.0 (Test)' },
    });
  });

  it('uses the __Secure- cookie name over https', async () => {
    const res = await POST(
      loginRequest({ email: 'alice@example.com', password: PASSWORD }, 'https://app.example.com/api/auth/password-login'),
    );

    expect(res.headers.get('set-cookie') ?? '').toContain('__Secure-authjs.session-token=');
  });

  it('trusts x-forwarded-proto, so TLS terminated at the proxy still gets a Secure cookie', async () => {
    // Production forwards plain http from Caddy to the container; without this
    // the cookie name would disagree with the one Auth.js reads and clears.
    const request = new Request('http://platform-ui:3000/api/auth/password-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ email: 'alice@example.com', password: PASSWORD }),
    });

    const cookie = (await POST(request)).headers.get('set-cookie') ?? '';
    expect(cookie).toContain('__Secure-authjs.session-token=');
    expect(cookie).toContain('Secure');
  });

  it('refuses a non-JSON content type, blocking cross-site form login CSRF', async () => {
    const request = new Request('http://localhost/api/auth/password-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=alice@example.com&password=' + PASSWORD,
    });

    const res = await POST(request);

    expect(res.status).toBe(415);
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  it('rejects a wrong password without opening a session', async () => {
    const res = await POST(loginRequest({ email: 'alice@example.com', password: 'wrong' }));

    expect(res.status).toBe(401);
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with the same response as a wrong password', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue(null);

    const res = await POST(loginRequest({ email: 'nobody@example.com', password: PASSWORD }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Incorrect email or password.' });
  });

  it('rejects a user that has no password hash', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      image: null,
      passwordHash: null,
    });

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(401);
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  // ADR-0021 §5, amending ADR-0002 §4a. This route cannot self-register — a
  // password hash exists only for an account an admin seeded (an invite, or a
  // redeemed join link) — so the allowlist only ever locked a legitimately
  // invited external colleague out of the password she had just been asked to
  // set. The allowlist keeps closing the door Google leaves open, in the
  // `signIn` callback.
  // ADR-0021 §5, amending ADR-0002 §4a. The allowlist governs SELF-SERVICE
  // sign-in, so an account nobody invited is still evicted by dropping its
  // domain — that is a live operator control the staging runbook uses by name.
  it('enforces ALLOWED_EMAIL_DOMAINS for a self-registered account, behind the generic rejection', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'mediforce.io';

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    // Same status and body as a wrong password: a distinct response would tell
    // an anonymous caller which domains this deployment accepts.
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Incorrect email or password.' });
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  it('admits an out-of-allowlist account an admin deliberately seeded', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'mediforce.io';
    mockAuthUserWasInvited.mockResolvedValue(true);

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(200);
    expect(mockCreateDatabaseSession).toHaveBeenCalledTimes(1);
  });

  it('404s when password auth is disabled', async () => {
    process.env.ENABLE_PASSWORD_AUTH = 'false';

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(404);
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  it('reports whether password auth is enabled so the login page can gate its form', async () => {
    expect(await (await GET()).json()).toEqual({ enabled: true });

    process.env.ENABLE_PASSWORD_AUTH = 'false';
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });
});
