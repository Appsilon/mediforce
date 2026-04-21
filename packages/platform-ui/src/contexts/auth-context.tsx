'use client';

import * as React from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  linkWithCredential,
  type OAuthCredential,
  type AuthError,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

function generateHandle(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  return localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'user';
}

const namespaceCreationInProgress = new Set<string>();

async function ensurePersonalNamespace(user: { uid: string; email: string | null; displayName: string | null }) {
  if (namespaceCreationInProgress.has(user.uid)) return;
  namespaceCreationInProgress.add(user.uid);

  try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    if (typeof userData.handle === 'string' && userData.handle !== '') {
      // Already has handle — check namespace exists
      const nsRef = doc(db, 'namespaces', userData.handle);
      const nsSnap = await getDoc(nsRef);
      if (!nsSnap.exists()) {
        await setDoc(nsRef, {
          handle: userData.handle,
          type: 'personal',
          displayName: user.displayName ?? user.email ?? userData.handle,
          linkedUserId: user.uid,
          createdAt: new Date().toISOString(),
        });
        await setDoc(doc(db, 'namespaces', userData.handle, 'members', user.uid), {
          uid: user.uid,
          role: 'owner',
          ...(user.displayName !== null ? { displayName: user.displayName } : {}),
          joinedAt: new Date().toISOString(),
        });
      }
      return;
    }

    // No handle in user doc — check if a personal namespace already exists for this uid
    const existingQuery = query(
      collection(db, 'namespaces'),
      where('linkedUserId', '==', user.uid),
      where('type', '==', 'personal'),
      limit(1),
    );
    const existingSnap = await getDocs(existingQuery);
    if (!existingSnap.empty) {
      const existingHandle = existingSnap.docs[0]!.id;
      await setDoc(userRef, { handle: existingHandle }, { merge: true });
      return;
    }

    // No handle yet — generate one and create namespace
    const baseHandle = generateHandle(user.email ?? user.uid);
    let handle = baseHandle;
    let attempt = 1;
    while (true) {
      const nsSnap = await getDoc(doc(db, 'namespaces', handle));
      if (!nsSnap.exists()) break;
      attempt += 1;
      handle = `${baseHandle}-${attempt}`;
    }

    await setDoc(doc(db, 'namespaces', handle), {
      handle,
      type: 'personal',
      displayName: user.displayName ?? user.email ?? handle,
      linkedUserId: user.uid,
      createdAt: new Date().toISOString(),
    });
    await setDoc(doc(db, 'namespaces', handle, 'members', user.uid), {
      uid: user.uid,
      role: 'owner',
      ...(user.displayName !== null ? { displayName: user.displayName } : {}),
      joinedAt: new Date().toISOString(),
    });
    await setDoc(userRef, { handle }, { merge: true });
  } finally {
    namespaceCreationInProgress.delete(user.uid);
  }
}

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
    await signInWithEmailAndPassword(auth, 'probe@probe.probe', 'probe');
    return true; // account exists against all odds — email auth is on
  } catch (err: unknown) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    // operation-not-allowed means the provider is disabled; everything else
    // (user-not-found, invalid-credential, wrong-password) means it is enabled
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
      setLoading(false);

      if (user !== null) {
        const profile: Record<string, string> = {};
        if (user.displayName !== null) profile.displayName = user.displayName;
        if (user.photoURL !== null) profile.photoURL = user.photoURL;
        if (user.email !== null) profile.email = user.email;
        profile.uid = user.uid;
        if (Object.keys(profile).length > 0) {
          setDoc(doc(db, 'users', user.uid), profile, { merge: true }).catch(() => {});
        }
        ensurePersonalNamespace(user).catch(() => {});

        // Check if user must change their temporary password
        getDoc(doc(db, 'users', user.uid)).then((snap) => {
          if (snap.exists()) {
            setMustChangePassword(snap.data().mustChangePassword === true);
          }
        }).catch(() => {});
      } else {
        setMustChangePassword(false);
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
