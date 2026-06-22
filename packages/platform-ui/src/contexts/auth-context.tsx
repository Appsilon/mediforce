'use client';

import * as React from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  linkWithCredential,
  type OAuthCredential,
  type AuthError,
  type User as FirebaseUser,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from '@/lib/firebase';
import { mediforce, ApiError } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { useUserMe } from '@/hooks/use-user-me';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  emailAuthEnabled: boolean | null; // null = probe in progress
  googleAuthEnabled: boolean | null; // null = probe in progress
  pendingGoogleLink: boolean; // true when Google SSO hit email conflict — sign in with password to link
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  clearMustChangePassword: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

async function probeGoogleAuth(): Promise<boolean> {
  const apiKey = auth.app.options.apiKey;
  if (typeof apiKey !== 'string' || apiKey === '') return false;
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'google.com', continueUri: 'http://localhost' }),
    });
    const data: unknown = await response.json();
    if (
      data !== null &&
      typeof data === 'object' &&
      'error' in data &&
      data.error !== null &&
      typeof data.error === 'object' &&
      'message' in data.error &&
      data.error.message === 'OPERATION_NOT_ALLOWED'
    ) {
      return false;
    }
    return response.ok;
  } catch {
    return false;
  }
}

async function probeEmailAuth(): Promise<boolean> {
  try {
    // fetchSignInMethodsForEmail is a read-only probe — no failed-auth side effects,
    // no rate-limit pressure, no audit-log noise. An OPERATION_NOT_ALLOWED error
    // means email/password sign-in is disabled; anything else means it's enabled.
    await fetchSignInMethodsForEmail(auth, 'probe@probe.probe');
    return true;
  } catch (err: unknown) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
    return code !== 'auth/operation-not-allowed';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = React.useState<FirebaseUser | null>(null);
  const [firebaseReady, setFirebaseReady] = React.useState(false);
  const [emailAuthEnabled, setEmailAuthEnabled] = React.useState<boolean | null>(null);
  const [googleAuthEnabled, setGoogleAuthEnabled] = React.useState<boolean | null>(null);
  const [pendingGoogleCredential, setPendingGoogleCredential] = React.useState<OAuthCredential | null>(null);
  const qc = useQueryClient();

  // Trigger /api/users/me as soon as the user is signed in. The handler
  // bootstraps the personal namespace on first call (formerly inline here as
  // `ensurePersonalNamespace`), then react-query keeps the cache warm for
  // every selector hook (`useNamespaceRole`, `useAllUserNamespaces`,
  // `usePersonalNamespace`). The query also carries `user.mustChangePassword`
  // — derived below into the context value so the layout's forced-reset
  // gate stays driven by server state, not a parallel firestore read.
  const userMe = useUserMe({ enabled: firebaseUser !== null });

  // Layout reads both `loading` and `mustChangePassword` before deciding
  // whether to redirect to `/change-password`. Clearing `loading` before
  // `useUserMe` resolves would let the layout render under the default
  // `mustChangePassword: false`, silently bypassing the forced-reset gate.
  // So we stay loading until either: Firebase Auth resolved no user
  // (anonymous path), or both auth and the `me` query have settled.
  const loading = !firebaseReady || (firebaseUser !== null && userMe.data === undefined && !userMe.isError);

  // Fail-closed for the gate: if the `me` query has errored we default the
  // flag to `true`, matching the pre-headless firestore-read behaviour.
  const mustChangePassword =
    firebaseUser !== null && userMe.isError ? true : userMe.data?.user.mustChangePassword === true;

  React.useEffect(() => {
    // In emulator mode both providers are always enabled — skip probes to avoid
    // spurious 400 console errors that break E2E tests.
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
      setEmailAuthEnabled(true);
      setGoogleAuthEnabled(true);
      return;
    }
    probeEmailAuth()
      .then(setEmailAuthEnabled)
      .catch(() => setEmailAuthEnabled(false));
    probeGoogleAuth()
      .then(setGoogleAuthEnabled)
      .catch(() => setGoogleAuthEnabled(false));
  }, []);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setFirebaseReady(true);
      if (user === null) {
        qc.removeQueries({ queryKey: queryKeys.users.me() });
      }
    });
    return unsub;
  }, [qc]);

  const signInWithGoogle = React.useCallback(async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setPendingGoogleCredential(null);
    } catch (err: unknown) {
      // Firebase "one account per email" mode: Google email matches an existing
      // email/password account. Store the Google credential so we can link it
      // after the user signs in with their password.
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'auth/account-exists-with-different-credential'
      ) {
        const credential = GoogleAuthProvider.credentialFromError(err as AuthError);
        if (credential !== null) {
          setPendingGoogleCredential(credential);
        }
        const linkError = new Error('auth/needs-link') as Error & { code: string };
        linkError.code = 'auth/needs-link';
        throw linkError;
      }
      throw err;
    }
  }, []);

  const signInWithEmail = React.useCallback(
    async (email: string, password: string) => {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // If a Google credential is pending (from a previous failed SSO attempt),
      // link it now so both sign-in methods work going forward.
      if (pendingGoogleCredential !== null) {
        try {
          await linkWithCredential(userCredential.user, pendingGoogleCredential);
        } catch {
          // Linking failed (e.g. already linked) — sign-in still succeeded, ignore.
        }
        setPendingGoogleCredential(null);
      }
    },
    [pendingGoogleCredential],
  );

  const sendPasswordReset = React.useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  const clearMustChangePassword = React.useCallback(async () => {
    if (auth.currentUser === null) return;
    // Changing the password revokes the user's existing ID tokens. The caller
    // re-authenticates first, but the SDK can still briefly hand a stale
    // (pre-change) token to this request, which the backend rejects as revoked
    // (401). Force a token refresh and retry so the call lands on the new
    // session's valid token. In production tokens aren't revoked on this path,
    // so the first attempt succeeds and the loop is a no-op.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await mediforce.users.clearMustChangePassword();
        break;
      } catch (err) {
        if (attempt >= 5 || !(err instanceof ApiError) || err.status !== 401) throw err;
        await auth.currentUser?.getIdToken(true);
      }
    }
    // refetchQueries (not invalidateQueries) so the `me` cache holds the fresh
    // `mustChangePassword: false` before the caller navigates. invalidateQueries
    // only refetches *active* observers and resolves immediately when none are
    // attached — during the post-change route transition the `me` observer can
    // detach, leaving the cache stale and bouncing the user back to
    // /change-password. refetchQueries always performs and awaits the refetch.
    await qc.refetchQueries({ queryKey: queryKeys.users.me() });
  }, [qc]);

  const signOut = React.useCallback(async () => {
    setPendingGoogleCredential(null);
    await firebaseSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        loading,
        mustChangePassword,
        emailAuthEnabled,
        googleAuthEnabled,
        pendingGoogleLink: pendingGoogleCredential !== null,
        signInWithGoogle,
        signInWithEmail,
        sendPasswordReset,
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
