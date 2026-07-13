import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, browserLocalPersistence, setPersistence } from 'firebase/auth';

// Only Auth stays on Firebase. The `firebase/firestore` SDK is gone — every
// data read/write flows through `mediforce.X.Y()` (ADR-0001 Phase 4 cutover
// gate for PG PR2 / #534). Firebase Storage is gone too — task attachments
// flow through the headless attachments API (ADR-0003). Anything that
// previously imported `db` / `storage` from this module is dead; the bundler
// enforces it via the `api-boundaries.test.ts` tripwire.

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const g = globalThis as Record<string, unknown>;
if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && !g.__FIREBASE_EMULATORS_CONNECTED__) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  setPersistence(auth, browserLocalPersistence);
  g.__FIREBASE_EMULATORS_CONNECTED__ = true;
}
