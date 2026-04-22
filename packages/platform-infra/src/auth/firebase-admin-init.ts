import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
}

function ensureAdminApp() {
  if (!getApps().length) {
    initializeApp();
  }
  return getApp();
}

export function getAdminAuth(): Auth {
  return getAuth(ensureAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(ensureAdminApp());
}
