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
} from '@mediforce/platform-infra';
import { parseAllowedDomains, isEmailDomainAllowed } from '@/lib/email-allowlist';

/**
 * NextAuth (Auth.js v5) — the single source of truth for authentication after
 * the Firebase Auth exit (ADR-0002 §2.1, PR2).
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

function buildProviders(): Provider[] {
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

  // Magic-link (Email) provider is DEFERRED for the MVP (ADR-0002 §4).

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
    providers: buildProviders(),
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
