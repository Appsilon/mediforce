import { NextResponse } from 'next/server';
import { isEmailDeliveryConfigured } from '@mediforce/platform-infra';

/**
 * The login page's email-related display flags, read the way Google is read off
 * `/api/auth/providers` and password off `/api/auth/password-login`:
 *
 *  - `enabled` — whether to reveal "Email me a sign-in link". A DISPLAY flag
 *    only. The Email (verification-token) provider itself is registered
 *    whenever email is configured (see `auth.ts`), because the invite-activation
 *    flow depends on `/api/auth/callback/email` regardless of whether login
 *    magic-links are offered. `ENABLE_MAGIC_LINK` controls only the reveal.
 *  - `emailDeliveryEnabled` — whether the deployment can send mail at all, which
 *    is the real precondition for "Expected a setup link? Resend". Gating that
 *    recovery on the two sign-in display flags hid it on a Google/OIDC-only
 *    deployment, where an expired activation link was then a dead end (#1109),
 *    even though `/api/auth/resend-setup-link` would have worked.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    enabled: process.env.ENABLE_MAGIC_LINK === 'true',
    emailDeliveryEnabled: isEmailDeliveryConfigured(),
  });
}
