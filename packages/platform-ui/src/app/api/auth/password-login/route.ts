import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compare } from 'bcryptjs';
import {
  getSharedPostgresClient,
  findPasswordCredentialByEmail,
  createDatabaseSession,
  recordSignIn,
  recordSignInAuditEvent,
  SESSION_TTL_MS,
  authUserWasInvited,
} from '@mediforce/platform-infra';
import { isPasswordAuthEnabled } from '@mediforce/platform-core';
import { sessionCookieName, isSecureRequest } from '@/lib/session-cookie';
import {
  parseAllowedDomains,
  isEmailDomainAllowed,
  isSignInAuthorized,
} from '@/lib/email-allowlist';

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
 * sign-in authorization rule, so every rejection costs one bcrypt round. Without it the "no such user" answer comes
 * back ~250 ms early and enumerates the directory.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.4nJmXQXbYCiL5C1xCtBHqAFwUeXPuLW';

function passwordAuthEnabled(): boolean {
  return isPasswordAuthEnabled(process.env.ENABLE_PASSWORD_AUTH);
}

/** `x-forwarded-for` may carry a client,proxy1,proxy2 chain behind a load
 *  balancer — the first entry is the original client. Falls back to
 *  `x-real-ip` for proxies that set that instead. */
function clientIpFrom(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
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

  // The same two-term rule the Auth.js `signIn` callback applies (ADR-0021 §5,
  // amending ADR-0002 §4a) — an allowlisted domain, or an account an admin
  // deliberately seeded. Applying the allowlist alone here used to lock a
  // legitimately invited external colleague out of the password she had just
  // been asked to set; dropping it altogether would have let anyone evicted by
  // a domain being removed keep signing in.
  //
  // It answers with the SAME 401 as a bad password: a distinct 403 would tell
  // an anonymous caller which domains are allowed. The bcrypt compare runs
  // against a dummy hash on a miss so a non-existent account costs the same
  // time as a wrong password.
  const authorized = isSignInAuthorized({
    domainAllowed: isEmailDomainAllowed(
      email,
      parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS),
    ),
    invited: await authUserWasInvited(db, email),
  });
  const passwordMatches = await compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!authorized || user === null || user.passwordHash === null || !passwordMatches) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  // Open the same `auth_sessions` row + cookie every other provider gets, so
  // revocation stays a single row delete (ADR-0002 §3).
  const sessionToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await createDatabaseSession(db, { sessionToken, userId: user.id, expires });
  await recordSignIn(db, user.id);
  // Fire-and-forget: this is Monitoring telemetry, not part of the sign-in
  // contract — the session cookie is already valid at this point, and a
  // transient DB hiccup on the audit write must not fail the login response.
  void recordSignInAuditEvent(db, {
    uid: user.id,
    method: {
      kind: 'password',
      ipAddress: clientIpFrom(request),
      userAgent: request.headers.get('user-agent'),
    },
  }).catch(() => {});

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
