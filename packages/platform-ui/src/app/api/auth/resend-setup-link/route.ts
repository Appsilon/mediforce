import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getSharedPostgresClient,
  findPasswordCredentialByEmail,
} from '@mediforce/platform-infra';
import { PLATFORM_BASE_URL_SETTING_KEY, normalizeBaseUrl } from '@mediforce/platform-api/contract';
import { getPlatformServices } from '@/lib/platform-services';
import { parseAllowedDomains, isEmailDomainAllowed } from '@/lib/email-allowlist';

/**
 * Self-service "resend my setup link" recovery.
 *
 * A PENDING invitee whose one-time activation link expired or never arrived can
 * request a fresh 7-day one themselves — no admin, no workspace context. It
 * works independent of `ENABLE_MAGIC_LINK`: the Email provider infra (used to
 * mint + deliver the sign-in link) is always registered whenever email is
 * configured, whether or not the magic-link login affordance is shown
 * (ADR-0002 invite-onboarding addendum).
 *
 * Anti-enumeration: the response is ALWAYS the same generic `200 { ok: true }`,
 * regardless of whether the address is a known pending invitee. Every failure
 * mode falls through to that same body without sending.
 *
 * Public by design (`proxy.ts` exempts `/api/auth/*`) — like `password-login`,
 * this is the accepted plain-route exception, not a Server Action.
 *
 * Rate-limiting is deferred to #1048.
 */
const BodySchema = z.object({
  email: z.string().email(),
});

const GENERIC_OK = { ok: true } as const;

export async function POST(request: Request): Promise<NextResponse> {
  // A cross-site form post can only send the three form encodings, so demanding
  // JSON blocks a CSRF-driven resend. Mirrors the `password-login` guard.
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
  // A malformed body is not an enumeration signal — answer with the SAME generic
  // 200 as every other outcome rather than leaking a distinct validation error.
  if (!parsed.success) {
    return NextResponse.json(GENERIC_OK);
  }
  const { email } = parsed.data;

  const { db } = getSharedPostgresClient();
  const user = await findPasswordCredentialByEmail(db, email);
  if (user === null) {
    return NextResponse.json(GENERIC_OK);
  }

  const allowed = isEmailDomainAllowed(
    email,
    parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS),
  );
  if (allowed !== true) {
    return NextResponse.json(GENERIC_OK);
  }

  const services = getPlatformServices();
  const pending = await services.inviteService.isInvitePending(user.id);
  // Active users already have a session/password — a setup link would be
  // meaningless (and a re-activation vector), so only PENDING invitees get one.
  if (pending !== true) {
    return NextResponse.json(GENERIC_OK);
  }

  if (services.inviteNotificationService !== null) {
    try {
      // The create-password gate only makes sense where a password can actually
      // be set. On a magic-link-only deployment the emailed link is purely a
      // sign-in link, and flagging the profile would strand the invitee on a
      // `/change-password` page whose `password-login` endpoint 404s.
      if (services.passwordAuthEnabled === true) {
        await services.userProfileRepo.setMustChangePassword(user.id, true);
      }
      // Prefer the deployment's configured `platform.baseUrl` setting (same as
      // the admin invite/resend handlers) so a deployment that set only the DB
      // setting — not the env var — still links to the real host rather than the
      // adapter's construction-time env fallback.
      const baseUrl = normalizeBaseUrl(
        await services.platformSettingsRepo.get(PLATFORM_BASE_URL_SETTING_KEY),
      );
      // No workspace context — the generic account-setup copy is used.
      await services.inviteNotificationService.sendActivationEmail({
        toEmail: email,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
    } catch (err) {
      // An email/delivery failure must never 500 or leak — log and still return
      // the same generic 200.
      console.error('[resend-setup-link] Failed to send activation email:', err);
    }
  }

  return NextResponse.json(GENERIC_OK);
}
