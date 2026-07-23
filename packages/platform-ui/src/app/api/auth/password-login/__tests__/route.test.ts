import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hashSync } from 'bcryptjs';

const mockFindPasswordCredentialByEmail = vi.fn();
const mockCreateDatabaseSession = vi.fn();
const mockRecordSignIn = vi.fn();
const mockPromoteFirebaseCredentialToBcrypt = vi.fn();
const mockVerifyFirebasePassword = vi.fn();
const mockResolveFirebaseScryptParams = vi.fn();

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  findPasswordCredentialByEmail: (...args: unknown[]) => mockFindPasswordCredentialByEmail(...args),
  createDatabaseSession: (...args: unknown[]) => mockCreateDatabaseSession(...args),
  recordSignIn: (...args: unknown[]) => mockRecordSignIn(...args),
  promoteFirebaseCredentialToBcrypt: (...args: unknown[]) =>
    mockPromoteFirebaseCredentialToBcrypt(...args),
  verifyFirebasePassword: (...args: unknown[]) => mockVerifyFirebasePassword(...args),
  resolveFirebaseScryptParams: (...args: unknown[]) => mockResolveFirebaseScryptParams(...args),
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
      firebasePasswordHash: null,
      firebaseSalt: null,
    });
    // Migrate-on-login off by default; the Firebase-legacy cases opt in.
    mockResolveFirebaseScryptParams.mockReturnValue(null);
    mockVerifyFirebasePassword.mockReturnValue(false);
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

  it('enforces ALLOWED_EMAIL_DOMAINS, and hides it behind the generic rejection', async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'mediforce.io';

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    // Same status and body as a wrong password: a distinct response would tell
    // an anonymous caller which domains this deployment accepts.
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Incorrect email or password.' });
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  const FIREBASE_LEGACY_RECORD = {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    image: null,
    passwordHash: null,
    firebasePasswordHash: 'lSrfV15cpx95==',
    firebaseSalt: '42xEC+ixf3L2lw==',
  };
  const SCRYPT_PARAMS = { signerKey: 'k', saltSeparator: 's', rounds: 8, memCost: 14 };

  it('migrates a Firebase-legacy user on a correct password: rehashes to bcrypt and opens a session', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue(FIREBASE_LEGACY_RECORD);
    mockResolveFirebaseScryptParams.mockReturnValue(SCRYPT_PARAMS);
    mockVerifyFirebasePassword.mockReturnValue(true);

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(200);
    expect(mockPromoteFirebaseCredentialToBcrypt).toHaveBeenCalledTimes(1);
    const [, uid, bcryptHash] = mockPromoteFirebaseCredentialToBcrypt.mock.calls[0] as [
      unknown,
      string,
      string,
    ];
    expect(uid).toBe('user-1');
    expect(bcryptHash.startsWith('$2')).toBe(true);
    expect(mockCreateDatabaseSession).toHaveBeenCalledTimes(1);
    expect(res.headers.get('set-cookie') ?? '').toContain('authjs.session-token=');
  });

  it('rejects a Firebase-legacy user on a wrong password without migrating', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue(FIREBASE_LEGACY_RECORD);
    mockResolveFirebaseScryptParams.mockReturnValue(SCRYPT_PARAMS);
    mockVerifyFirebasePassword.mockReturnValue(false);

    const res = await POST(loginRequest({ email: 'alice@example.com', password: 'wrong' }));

    expect(res.status).toBe(401);
    expect(mockPromoteFirebaseCredentialToBcrypt).not.toHaveBeenCalled();
    expect(mockCreateDatabaseSession).not.toHaveBeenCalled();
  });

  it('rejects a Firebase-legacy user when migrate-on-login is off (params absent), without crashing', async () => {
    mockFindPasswordCredentialByEmail.mockResolvedValue(FIREBASE_LEGACY_RECORD);
    mockResolveFirebaseScryptParams.mockReturnValue(null);

    const res = await POST(loginRequest({ email: 'alice@example.com', password: PASSWORD }));

    expect(res.status).toBe(401);
    expect(mockVerifyFirebasePassword).not.toHaveBeenCalled();
    expect(mockPromoteFirebaseCredentialToBcrypt).not.toHaveBeenCalled();
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
