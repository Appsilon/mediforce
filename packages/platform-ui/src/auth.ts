import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import type { Adapter } from 'next-auth/adapters';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import Google from 'next-auth/providers/google';
import {
  getSharedPostgresClient,
  authUsers,
  authAccounts,
  authSessions,
  authVerificationTokens,
  getUserRoles,
  recordSignIn,
  resolveEmailSenderFromEnv,
  findPasswordCredentialByEmail,
} from '@mediforce/platform-infra';
import type { Database } from '@mediforce/platform-infra';
import { parseAllowedDomains, isEmailDomainAllowed } from '@/lib/email-allowlist';
import { buildMagicLinkEmail } from '@/lib/magic-link-email';
import { shouldSendMagicLink } from '@/lib/magic-link-gate';

/**
 * NextAuth (Auth.js v5) — the single source of truth for authentication after
 * the Firebase Auth exit (ADR-0002 §1, PLAN-0002 §2.1).
 *
 * Providers are env-gated and additive (ADR-0002 §4): Google OAuth and a
 * dormant OIDC provider for pharma SSO. Password sign-in (dev / E2E /
 * air-gapped demos) does NOT live here — Auth.js rejects a Credentials provider
 * under the database session strategy, so it is its own route,
 * `/api/auth/password-login`, opening the same `auth_sessions` row.
 * Sessions are `database`-strategy (ADR-0002 §3)
 * so revocation is a single row delete; the httpOnly session cookie carries the
 * `auth_sessions.session_token` verbatim, which `proxy.ts` and
 * `resolveCallerIdentity` resolve to a uid via `resolveSessionUserId`.
 */

function buildAdapter(): Adapter {
  const { db } = getSharedPostgresClient();
  return DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  });
}

function buildProviders(db: Database): Provider[] {
  const providers: Provider[] = [];

  if (process.env.GOOGLE_CLIENT_ID) {
    providers.push(
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // ADR-0002 §4b: link onto a migration-seeded user with the same
        // (verified) email. Safe ONLY because Google verifies emails and
        // ALLOWED_EMAIL_DOMAINS gates the domain. NEVER enable this on an
        // unverified-email provider (account-takeover).
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  // Password sign-in lives in `/api/auth/password-login`, not here — see the
  // module docblock.

  // Magic-link (Email) provider (ADR-0002 §4). Fully compatible with database
  // sessions: it mints the same `auth_sessions` row + cookie as Google. After
  // signing in the user sets a first password via `POST /api/users/set-password`.
  if (process.env.ENABLE_MAGIC_LINK === 'true') {
    // Reuse the shared resolver so magic-link and platform-services agree on
    // the active provider. `null` means email is disabled — fail loud rather
    // than silently drop the only sign-in method the deployment enabled. A
    // misconfiguration throws from within the resolver (also loud).
    const resolvedEmail = resolveEmailSenderFromEnv();
    if (resolvedEmail === null) {
      throw new Error(
        'ENABLE_MAGIC_LINK=true requires an email provider (Mailgun/SMTP) and ' +
        'MEDIFORCE_DISABLE_EMAIL must not be set.',
      );
    }
    providers.push({
      id: 'email',
      type: 'email',
      name: 'Email',
      from: resolvedEmail.from,
      // 15-minute link validity.
      maxAge: 60 * 15,
      async sendVerificationRequest(params: { identifier: string; url: string }) {
        const { identifier, url } = params;
        // Account-creation gate (ADR-0002 §4). The Email provider would
        // otherwise let ANY address request a link, and the adapter would
        // self-register a new `auth_users` row on callback. Only send when the
        // address already belongs to a user AND its domain is allowlisted; the
        // adapter can never create a user because no link was ever minted.
        // On a miss we return WITHOUT sending and WITHOUT throwing, so the UI
        // shows the same "check your email" either way (anti-enumeration).
        const credential = await findPasswordCredentialByEmail(db, identifier);
        const domainAllowed = isEmailDomainAllowed(
          identifier,
          parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS),
        );
        if (!shouldSendMagicLink({ userExists: credential !== null, domainAllowed })) {
          return;
        }
        const { subject, text, html } = buildMagicLinkEmail(url);
        await resolvedEmail.send({ to: [identifier], subject, text, html });
      },
    } as Provider);
  }

  if (process.env.OIDC_ISSUER) {
    providers.push({
      id: 'customer-sso',
      name: process.env.OIDC_DISPLAY_NAME ?? 'Sign in with SSO',
      type: 'oidc',
      issuer: process.env.OIDC_ISSUER,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
    });
  }

  return providers;
}

/**
 * Built per request, not at module load: `next build` collects page data for
 * `/api/auth/[...nextauth]` with no database around, and opening the Postgres
 * client eagerly fails the production build.
 */
export function buildAuthConfig(): NextAuthConfig {
  const { db } = getSharedPostgresClient();
  return {
    adapter: buildAdapter(),
    session: { strategy: 'database' },
    trustHost: true,
    pages: { signIn: '/login' },
    providers: buildProviders(db),
    callbacks: {
      async signIn({ user }) {
        // ADR-0002 §4a: reject a sign-in whose email domain is not allowlisted.
        // Personal-workspace bootstrap is NOT done here — it stays the lazy,
        // idempotent `GET /api/users/me` bootstrap (get-me handler), so the
        // handle-generation logic lives in exactly one place.
        return isEmailDomainAllowed(user.email, parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS));
      },
      async session({ session, user }) {
        // Explicit allowlist — NEVER spread `user`, which carries `passwordHash`.
        session.user.id = user.id;
        session.user.roles = await getUserRoles(db, user.id);
        return session;
      },
    },
    events: {
      // Fires once per sign-in, unlike the `session` callback which runs on
      // every session read — see `recordSignIn`.
      async signIn({ user }) {
        if (typeof user.id === 'string') await recordSignIn(db, user.id);
      },
    },
  };
}

export const { auth, handlers, signIn, signOut } = NextAuth(() => buildAuthConfig());
