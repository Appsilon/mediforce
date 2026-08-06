'use client';

import * as React from 'react';
import { useSession, signIn, signOut as nextAuthSignOut, getProviders } from 'next-auth/react';
import type { Session } from 'next-auth';
import { useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { apiFetch } from '@/lib/api-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useUserMe } from '@/hooks/use-user-me';

export type SessionUser = Session['user'];

const PASSWORD_LOGIN_PATH = '/api/auth/password-login';
const MAGIC_LINK_LOGIN_PATH = '/api/auth/magic-link-login';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  passwordAuthEnabled: boolean | null; // null = provider list not loaded yet
  googleAuthEnabled: boolean | null; // null = provider list not loaded yet
  magicLinkEnabled: boolean | null; // null = provider list not loaded yet
  /** Whether the deployment can email a one-time link — the precondition for the
   *  login page's "Expected a setup link? Resend" recovery. Independent of which
   *  sign-in methods are offered. `null` = provider list not loaded yet. */
  emailDeliveryEnabled: boolean | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  clearMustChangePassword: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

/** Thrown by `signInWithEmail` when NextAuth rejects the credentials, so the
 *  login page can surface an error without a Firebase-specific error code. */
export class CredentialsSignInError extends Error {
  constructor() {
    super('auth/invalid-credentials');
    this.name = 'CredentialsSignInError';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status, update: refreshSession } = useSession();
  const [passwordAuthEnabled, setPasswordAuthEnabled] = React.useState<boolean | null>(null);
  const [googleAuthEnabled, setGoogleAuthEnabled] = React.useState<boolean | null>(null);
  const [magicLinkEnabled, setMagicLinkEnabled] = React.useState<boolean | null>(null);
  const [emailDeliveryEnabled, setEmailDeliveryEnabled] = React.useState<boolean | null>(null);
  const qc = useQueryClient();

  const user = session?.user ?? null;
  const isAuthenticated = status === 'authenticated';

  // Which sign-in methods this deployment enabled (ADR-0002 §4). OAuth comes
  // from NextAuth's own /api/auth/providers; password sign-in and magic-link
  // login are not gated by Auth.js provider presence (the Email provider is
  // always registered when email is configured, to power invite links), so each
  // reports its login-page display flag from its own route.
  React.useEffect(() => {
    let active = true;
    getProviders()
      .then((providers) => {
        if (active) {
          setGoogleAuthEnabled(providers?.google !== undefined);
        }
      })
      .catch(() => {
        if (active) {
          setGoogleAuthEnabled(false);
        }
      });
    apiFetch(PASSWORD_LOGIN_PATH, { reportErrors: false })
      .then((res) => res.json())
      .then((body: { enabled?: boolean }) => {
        if (active) setPasswordAuthEnabled(body.enabled === true);
      })
      .catch(() => {
        if (active) setPasswordAuthEnabled(false);
      });
    apiFetch(MAGIC_LINK_LOGIN_PATH, { reportErrors: false })
      .then((res) => res.json())
      .then((body: { enabled?: boolean; emailDeliveryEnabled?: boolean }) => {
        if (active) {
          setMagicLinkEnabled(body.enabled === true);
          setEmailDeliveryEnabled(body.emailDeliveryEnabled === true);
        }
      })
      .catch(() => {
        if (active) {
          setMagicLinkEnabled(false);
          setEmailDeliveryEnabled(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Clear the cached `me` view when the session ends so a subsequent sign-in
  // does not briefly render the previous user's data.
  React.useEffect(() => {
    if (status === 'unauthenticated') {
      qc.removeQueries({ queryKey: queryKeys.users.me() });
    }
  }, [status, qc]);

  // Drive the personal-namespace bootstrap + `mustChangePassword` gate off
  // `GET /api/users/me` (the same lazy, idempotent bootstrap as before — the
  // session cookie rides automatically now, no Bearer). See ADR-0002 §6.
  const userMe = useUserMe({ enabled: isAuthenticated });

  // Stay loading until the session resolves, and (when authenticated) until the
  // `me` query settles — otherwise the layout could render under the default
  // `mustChangePassword: false` and bypass the forced-reset gate.
  const loading =
    status === 'loading' || (isAuthenticated && userMe.data === undefined && !userMe.isError);

  // Fail-closed for the gate: a `me` error defaults the flag to `true`.
  const mustChangePassword = isAuthenticated && userMe.isError
    ? true
    : userMe.data?.user.mustChangePassword === true;

  const signInWithGoogle = React.useCallback(async () => {
    // Full-page redirect through Google; the callback lands back on the app.
    // Verified-email auto-link (ADR-0002 §4b) attaches to a seeded user — no
    // password-link dance.
    await signIn('google', { callbackUrl: '/' });
  }, []);

  const signInWithEmail = React.useCallback(
    async (email: string, password: string) => {
      // Not `signIn('credentials', …)`: password auth is a plain route because
      // Auth.js forbids a Credentials provider under database sessions. The
      // route sets the same session cookie, so a session refetch picks it up.
      // `reportErrors: false`: a wrong password is a locally handled 401 that
      // the login form reports itself — the global "your session may have
      // expired" toast would contradict it, on a page with no session.
      const res = await apiFetch(PASSWORD_LOGIN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        reportErrors: false,
      });
      if (!res.ok) {
        throw new CredentialsSignInError();
      }
      await refreshSession();
    },
    [refreshSession],
  );

  const signInWithMagicLink = React.useCallback(async (email: string) => {
    // `redirect: false` so we stay on `/login` and render our own styled
    // "check your email" confirmation instead of Auth.js's unstyled default
    // verify-request page. The callbackUrl is still baked into the emailed link,
    // so clicking it mints the same `auth_sessions` row + cookie as Google and
    // lands on the workspace selection.
    await signIn('email', { email, redirect: false, callbackUrl: '/workspace-selection' });
  }, []);

  const clearMustChangePassword = React.useCallback(async () => {
    await mediforce.users.clearMustChangePassword();
    // refetchQueries (not invalidateQueries) so the `me` cache holds the fresh
    // `mustChangePassword: false` before the caller navigates — invalidate only
    // refetches active observers and can leave the cache stale mid-transition,
    // bouncing the user back to /change-password.
    await qc.refetchQueries({ queryKey: queryKeys.users.me() });
  }, [qc]);

  const signOut = React.useCallback(async () => {
    await nextAuthSignOut({ callbackUrl: '/login' });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        mustChangePassword,
        passwordAuthEnabled,
        googleAuthEnabled,
        magicLinkEnabled,
        emailDeliveryEnabled,
        signInWithGoogle,
        signInWithEmail,
        signInWithMagicLink,
        clearMustChangePassword,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
