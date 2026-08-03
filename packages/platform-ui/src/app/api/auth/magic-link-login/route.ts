import { NextResponse } from 'next/server';

/**
 * Whether this deployment offers magic-link sign-in on the login page — the
 * login page gates its "Email me a sign-in link" reveal on this, the way it
 * reads Google off `/api/auth/providers` and password off
 * `/api/auth/password-login`.
 *
 * This is a DISPLAY flag only. The Email (verification-token) provider itself
 * is registered whenever email is configured (see `auth.ts`), because the
 * invite-activation flow depends on `/api/auth/callback/email` regardless of
 * whether login magic-links are offered. `ENABLE_MAGIC_LINK` controls only the
 * login-page reveal.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ enabled: process.env.ENABLE_MAGIC_LINK === 'true' });
}
