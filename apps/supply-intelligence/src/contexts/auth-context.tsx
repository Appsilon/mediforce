'use client';

import * as React from 'react';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

const ALLOWED_GOOGLE_DOMAIN = 'appsilon.com';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: ALLOWED_GOOGLE_DOMAIN });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = React.useState<FirebaseUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      setLoading(false);
    });

    return () => {
      unsubAuth();
    };
  }, []);

  const handleSignInWithGoogle = React.useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const email = result.user.email;
    if (email && !email.endsWith(`@${ALLOWED_GOOGLE_DOMAIN}`)) {
      await firebaseSignOut(auth);
      throw new Error(`Only @${ALLOWED_GOOGLE_DOMAIN} accounts are allowed.`);
    }
  }, []);

  const handleSignInWithEmail = React.useCallback(
    async (email: string, password: string) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    [],
  );

  const handleSignOut = React.useCallback(async () => {
    await firebaseSignOut(auth);
    setFirebaseUser(null);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      loading,
      signInWithGoogle: handleSignInWithGoogle,
      signInWithEmail: handleSignInWithEmail,
      signOut: handleSignOut,
    }),
    [firebaseUser, loading, handleSignInWithGoogle, handleSignInWithEmail, handleSignOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
