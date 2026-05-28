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
// TODO(phase-4 follow-up): The `mustChangePassword` flag is the last
// firestore read in this file. Moving it to a dedicated endpoint
// (`GET /api/users/me` extension + `POST /api/users/me/clear-must-change-password`)
// requires a new `UserProfileRepository`; tracked separately to keep PR4
// focused on the namespace + identity bundle. The personal-namespace
// bootstrap that used to live here moved to the handler-side lazy create.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'google.com', continueUri: 'http://localhost' }),
      },
    );
    const data: unknown = await response.json();
    if (
      data !== null && typeof data === 'object' &&
      'error' in data && data.error !== null && typeof data.error === 'object' &&
      'message' in data.error && data.error.message === 'OPERATION_NOT_ALLOWED'
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
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    return code !== 'auth/operation-not-allowed';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = React.useState<FirebaseUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mustChangePassword, setMustChangePassword] = React.useState(false);
  const [emailAuthEnabled, setEmailAuthEnabled] = React.useState<boolean | null>(null);
  const [googleAuthEnabled, setGoogleAuthEnabled] = React.useState<boolean | null>(null);
  const [pendingGoogleCredential, setPendingGoogleCredential] = React.useState<OAuthCredential | null>(null);

  // Trigger /api/users/me as soon as the user is signed in. The handler
  // bootstraps the personal namespace on first call (formerly inline here as
  // `ensurePersonalNamespace`), then react-query keeps the cache warm for
  // every selector hook (`useNamespaceRole`, `useAllUserNamespaces`,
  // `usePersonalNamespace`). The query result is consumed via the cache, not
  // through this provider, so we just need it to *run*.
  useUserMe({ enabled: firebaseUser !== null });

  React.useEffect(() => {
    // In emulator mode both providers are always enabled — skip probes to avoid
    // spurious 400 console errors that break E2E tests.
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
      setEmailAuthEnabled(true);
      setGoogleAuthEnabled(true);
      return;
    }
    probeEmailAuth().then(setEmailAuthEnabled).catch(() => setEmailAuthEnabled(false));
    probeGoogleAuth().then(setGoogleAuthEnabled).catch(() => setGoogleAuthEnabled(false));
  }, []);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);

      if (user !== null) {
        // Resolve mustChangePassword BEFORE clearing loading — layout reads
        // both flags to decide whether to redirect to /change-password.
        // Clearing loading first lets layout render with the default
        // mustChangePassword=false and skip the redirect.
        getDoc(doc(db, 'users', user.uid)).then((snap) => {
          if (snap.exists()) {
            setMustChangePassword(snap.data().mustChangePassword === true);
          }
          setLoading(false);
        }).catch((err) => {
          // Fail-closed: if we cannot read mustChangePassword, assume it is true so
          // the forced-reset gate is never silently bypassed by a rules rejection or
          // transient network error.
          console.error('[auth] Failed to read user doc for mustChangePassword — failing closed:', err);
          setMustChangePassword(true);
          setLoading(false);
        });
      } else {
        setMustChangePassword(false);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

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

  const signInWithEmail = React.useCallback(async (email: string, password: string) => {
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
  }, [pendingGoogleCredential]);

  const sendPasswordReset = React.useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  const clearMustChangePassword = React.useCallback(async () => {
    if (auth.currentUser !== null) {
      await setDoc(doc(db, 'users', auth.currentUser.uid), { mustChangePassword: false }, { merge: true });
      setMustChangePassword(false);
    }
  }, []);

  const signOut = React.useCallback(async () => {
    setPendingGoogleCredential(null);
    await firebaseSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, loading, mustChangePassword, emailAuthEnabled, googleAuthEnabled, pendingGoogleLink: pendingGoogleCredential !== null, signInWithGoogle, signInWithEmail, sendPasswordReset, clearMustChangePassword, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
