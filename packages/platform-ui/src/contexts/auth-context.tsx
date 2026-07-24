'use client';

import * as React from 'react';
import { useSession, signIn, signOut as nextAuthSignOut, getProviders } from 'next-auth/react';
import type { Session } from 'next-auth';
import { useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { useUserMe } from '@/hooks/use-user-me';

export type SessionUser = Session['user'];

const PASSWORD_LOGIN_PATH = '/api/auth/password-login';

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  emailAuthEnabled: boolean | null; // null = provider list not loaded yet
  googleAuthEnabled: boolean | null; // null = provider list not loaded yet
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
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
  const [emailAuthEnabled, setEmailAuthEnabled] = React.useState<boolean | null>(null);
  const [googleAuthEnabled, setGoogleAuthEnabled] = React.useState<boolean | null>(null);
  const qc = useQueryClient();

  const user = session?.user ?? null;
  const isAuthenticated = status === 'authenticated';

  // Which sign-in methods this deployment enabled (ADR-0002 §4). OAuth comes
  // from NextAuth's own /api/auth/providers; password sign-in is not an Auth.js
  // provider (see `/api/auth/password-login`) so it reports itself.
  React.useEffect(() => {
    let active = true;
    getProviders()
      .then((providers) => {
        if (active) setGoogleAuthEnabled(providers?.google !== undefined);
      })
      .catch(() => {
        if (active) setGoogleAuthEnabled(false);
      });
    fetch(PASSWORD_LOGIN_PATH)
      .then((res) => res.json())
      .then((body: { enabled?: boolean }) => {
        if (active) setEmailAuthEnabled(body.enabled === true);
      })
      .catch(() => {
        if (active) setEmailAuthEnabled(false);
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
      const res = await fetch(PASSWORD_LOGIN_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        throw new CredentialsSignInError();
      }
      await refreshSession();
    },
    [refreshSession],
  );

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
        emailAuthEnabled,
        googleAuthEnabled,
        signInWithGoogle,
        signInWithEmail,
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
