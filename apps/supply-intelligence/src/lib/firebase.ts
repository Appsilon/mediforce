import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const APP_NAME = 'supply-intelligence';
const app = getApps().find((a) => a.name === APP_NAME) ?? initializeApp(firebaseConfig, APP_NAME);
export const auth = getAuth(app);
const DB_NAME = 'supply-intelligence';
export const db = getFirestore(app, DB_NAME);

const g = globalThis as Record<string, unknown>;
if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && !g.__SI_FIREBASE_EMULATORS_CONNECTED__) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  setPersistence(auth, browserLocalPersistence);
  g.__SI_FIREBASE_EMULATORS_CONNECTED__ = true;
}

export { app };
