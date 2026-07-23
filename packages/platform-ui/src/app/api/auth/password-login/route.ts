import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compare, hash } from 'bcryptjs';
import {
  getSharedPostgresClient,
  findPasswordCredentialByEmail,
  createDatabaseSession,
  recordSignIn,
  promoteFirebaseCredentialToBcrypt,
  verifyFirebasePassword,
  resolveFirebaseScryptParams,
  SESSION_TTL_MS,
  type Database,
} from '@mediforce/platform-infra';
import { parseAllowedDomains, isEmailDomainAllowed } from '@/lib/email-allowlist';
import { sessionCookieName, isSecureRequest } from '@/lib/session-cookie';

/**
 * Password sign-in (ADR-0002 §4: dev / E2E / air-gapped demos).
 *
 * This is deliberately NOT an Auth.js Credentials provider: Auth.js refuses to
 * combine a Credentials provider with `session.strategy: 'database'`
 * (`UnsupportedStrategy`), and it fails the whole `/api/auth/*` surface at
 * config load, not just the password path. Database sessions are the ADR-0002
 * §3 requirement (revocation = one row delete), so password login opens the
 * same `auth_sessions` row every other provider gets and sets the same cookie.
 * Google/OIDC keep going through Auth.js untouched.
 *
 * Public by design (`proxy.ts` exempts `/api/auth/*`) — you cannot present a
 * session while obtaining one.
 */
const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const INVALID_CREDENTIALS = { error: 'Incorrect email or password.' } as const;

/**
 * Compared against when the email is unknown, has no password, or fails the
 * domain allowlist, so every rejection costs one bcrypt round. Without it the
 * "no such user" answer comes back ~250 ms early and enumerates the directory.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.4nJmXQXbYCiL5C1xCtBHqAFwUeXPuLW';

function passwordAuthEnabled(): boolean {
  return process.env.ENABLE_PASSWORD_AUTH === 'true';
}

/** Whether this deployment offers password sign-in — the login page gates its
 *  form on this, the way it reads Google off `/api/auth/providers`. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ enabled: passwordAuthEnabled() });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!passwordAuthEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // A cross-site form post can only send the three form encodings, so
  // demanding JSON is what stops a login-CSRF logging a victim into an
  // attacker's account. Auth.js's own routes get this from their CSRF token.
  if (request.headers.get('content-type')?.startsWith('application/json') !== true) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }
  const { email, password } = parsed.data;

  const { db } = getSharedPostgresClient();
  const user = await findPasswordCredentialByEmail(db, email);

  // The allowlist gate matches the Auth.js `signIn` callback for OAuth
  // (ADR-0002 §4a), but it answers with the SAME 401 as a bad password: a
  // distinct 403 would tell an anonymous caller which domains are allowed.
  const allowed = isEmailDomainAllowed(
    email,
    parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS),
  );
  const passwordMatches = await compare(password, user?.passwordHash ?? DUMMY_HASH);
  const bcryptSucceeded =
    allowed && user !== null && user.passwordHash !== null && passwordMatches;
  if (bcryptSucceeded) {
    return establishSession(db, request, user.id);
  }

  // Migrate-on-login (ADR-0002 Gap 2): a migrated Firebase user has no bcrypt
  // hash yet but carries the legacy scrypt credential. Firebase scrypt cannot
  // convert to bcrypt offline, but it CAN be verified here; on success we rehash
  // the plaintext to bcrypt and clear the legacy columns atomically, then open
  // the session exactly like a bcrypt sign-in — transparent to the user, and it
  // runs at most once per migrated account.
  if (
    allowed &&
    user !== null &&
    user.passwordHash === null &&
    user.firebasePasswordHash !== null &&
    user.firebaseSalt !== null
  ) {
    // Params absent => migrate-on-login is switched off for this deployment (a
    // documented "feature off", not a silent corruption fallback). Partial
    // config THROWS on purpose: a half-configured deployment is a
    // misconfiguration and a 500 is the correct, loud answer — do not swallow.
    const params = resolveFirebaseScryptParams();
    if (
      params !== null &&
      verifyFirebasePassword(password, user.firebasePasswordHash, user.firebaseSalt, params)
    ) {
      const bcryptHash = await hash(password, 12);
      await promoteFirebaseCredentialToBcrypt(db, user.id, bcryptHash);
      return establishSession(db, request, user.id);
    }
  }

  return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
}

/**
 * Open the `auth_sessions` row and set the session cookie for a verified user —
 * the shared success tail of the bcrypt and migrate-on-login paths.
 */
async function establishSession(
  db: Database,
  request: Request,
  userId: string,
): Promise<NextResponse> {
  const sessionToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await createDatabaseSession(db, { sessionToken, userId, expires });
  await recordSignIn(db, userId);

  const secure = isSecureRequest(request);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(secure), sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    expires,
  });
  return response;
}
