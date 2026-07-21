import { randomUUID } from 'node:crypto';
import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import { encode as defaultJwtEncode } from 'next-auth/jwt';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  getSharedPostgresClient,
  authUsers,
  authAccounts,
  authSessions,
  authVerificationTokens,
  createDatabaseSession,
  getUserRoles,
  SESSION_TTL_MS,
} from '@mediforce/platform-infra';
import { parseAllowedDomains, isEmailDomainAllowed } from '@/lib/email-allowlist';

/**
 * NextAuth (Auth.js v5) — the single source of truth for authentication after
 * the Firebase Auth exit (ADR-0002 §2.1, PR2).
 *
 * Providers are env-gated and additive (ADR-0002 §4): Google OAuth, a
 * Credentials/password provider (dev / E2E / air-gapped demos), and a dormant
 * OIDC provider for pharma SSO. Sessions are `database`-strategy (ADR-0002 §3)
 * so revocation is a single row delete; the httpOnly session cookie carries the
 * `auth_sessions.session_token` verbatim, which `proxy.ts` and
 * `resolveCallerIdentity` resolve to a uid via `resolveSessionUserId`.
 */

const { db } = getSharedPostgresClient();

const adapter = DrizzleAdapter(db, {
  usersTable: authUsers,
  accountsTable: authAccounts,
  sessionsTable: authSessions,
  verificationTokensTable: authVerificationTokens,
});

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

  if (process.env.ENABLE_PASSWORD_AUTH === 'true') {
    providers.push(
      Credentials({
        name: 'Password',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          const email = credentials?.email;
          const password = credentials?.password;
          if (typeof email !== 'string' || typeof password !== 'string') return null;
          const user = await db.query.authUsers.findFirst({
            where: eq(authUsers.email, email),
          });
          if (!user?.passwordHash) return null;
          const ok = await compare(password, user.passwordHash);
          if (!ok) return null;
          return { id: user.id, email: user.email, name: user.name, image: user.image };
        },
      }),
    );
  }

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

export const authConfig: NextAuthConfig = {
  adapter,
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
    // Credentials logins do not go through the adapter's `createSession`
    // (Auth.js limitation with the database strategy). Flag them here so
    // `jwt.encode` below mints a real `auth_sessions` row and returns its token
    // as the cookie value — keeping every provider on one revocable session
    // model.
    async jwt({ token, account }) {
      if (account?.provider === 'credentials' && typeof token.sub === 'string') {
        const sessionToken = randomUUID();
        await createDatabaseSession(db, {
          sessionToken,
          userId: token.sub,
          expires: new Date(Date.now() + SESSION_TTL_MS),
        });
        token.sessionId = sessionToken;
      }
      return token;
    },
    async session({ session, user }) {
      // Explicit allowlist — NEVER spread `user`, which carries `passwordHash`.
      session.user.id = user.id;
      session.user.roles = await getUserRoles(db, user.id);
      return session;
    },
  },
  jwt: {
    async encode(params) {
      const sessionId = (params.token as { sessionId?: string } | undefined)?.sessionId;
      if (typeof sessionId === 'string') return sessionId;
      return defaultJwtEncode(params);
    },
  },
};

export const { auth, handlers, signIn, signOut } = NextAuth(authConfig);
