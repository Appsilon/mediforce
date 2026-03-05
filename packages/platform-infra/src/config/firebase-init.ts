import { initializeApp, getApps, getApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';

/**
 * Firebase configuration object.
 * Defined locally — NOT exported to other packages.
 * Calling code outside platform-infra never sees this type.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

let firebaseApp: FirebaseApp | null = null;

/**
 * Initialize the Firebase app. Safe to call multiple times —
 * subsequent calls return the existing app.
 */
export function initializeFirebase(config: FirebaseConfig): FirebaseApp {
  if (getApps().length > 0) {
    firebaseApp = getApp();
    return firebaseApp;
  }

  firebaseApp = initializeApp(config);
  return firebaseApp;
}

/**
 * Get the Firestore database instance.
 * Throws if Firebase has not been initialized.
 */
export function getFirestoreDb(): Firestore {
  if (!firebaseApp && getApps().length === 0) {
    throw new Error(
      'Firebase has not been initialized. Call initializeFirebase() first.',
    );
  }

  const app = firebaseApp ?? getApp();
  return getFirestore(app);
}

/**
 * Get the Firebase Auth instance.
 * Throws if Firebase has not been initialized.
 */
export function getFirebaseAuth(): Auth {
  if (!firebaseApp && getApps().length === 0) {
    throw new Error(
      'Firebase has not been initialized. Call initializeFirebase() first.',
    );
  }

  const app = firebaseApp ?? getApp();
  return getAuth(app);
}
