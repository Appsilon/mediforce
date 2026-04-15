'use client';

import * as React from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
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
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = React.useState<FirebaseUser | null>(null);
  const [loading, setLoading] = React.useState(true);

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
      }
    });
    return unsub;
  }, []);

  const signInWithGoogle = React.useCallback(async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }, []);

  const signInWithEmail = React.useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const sendPasswordReset = React.useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  const signOut = React.useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, loading, signInWithGoogle, signInWithEmail, sendPasswordReset, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
