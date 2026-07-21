import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashSync } from 'bcryptjs';

const mockFindPasswordCredentialByEmail = vi.fn();
const mockCreateDatabaseSession = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  findPasswordCredentialByEmail: (...args: unknown[]) => mockFindPasswordCredentialByEmail(...args),
  createDatabaseSession: (...args: unknown[]) => mockCreateDatabaseSession(...args),
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
    mockFindPasswordCredentialByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      image: null,
      passwordHash: PASSWORD_HASH,
    });
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
  });

  it('uses the __Secure- cookie name over https', async () => {
    const res = await POST(
      loginRequest({ email: 'alice@example.com', password: PASSWORD }, 'https://app.example.com/api/auth/password-login'),
    );

    expect(res.headers.get('set-cookie') ?? '').toContain('__Secure-authjs.session-token=');
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

  it('enforces ALLOWED_EMAIL_DOMAINS like the OAuth sign-in callback', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'mediforce.io';

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(403);
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
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
