import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compare } from 'bcryptjs';
import {
  getSharedPostgresClient,
  findPasswordCredentialByEmail,
  createDatabaseSession,
  SESSION_TTL_MS,
} from '@mediforce/platform-infra';
import { parseAllowedDomains, isEmailDomainAllowed } from '@/lib/email-allowlist';
import { sessionCookieName } from '@/lib/session-cookie';

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

  // Same gate as the Auth.js `signIn` callback applies to OAuth (ADR-0002 §4a).
  if (!isEmailDomainAllowed(email, parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS))) {
    return NextResponse.json({ error: 'This account is not permitted to sign in.' }, { status: 403 });
  }

  const { db } = getSharedPostgresClient();
  const user = await findPasswordCredentialByEmail(db, email);
  if (user?.passwordHash == null) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }
  if (!(await compare(password, user.passwordHash))) {
    return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const sessionToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, '');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await createDatabaseSession(db, { sessionToken, userId: user.id, expires });

  const secure = new URL(request.url).protocol === 'https:';
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
