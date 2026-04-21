import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

function ensureAdminApp() {
  if (!getApps().length) {
    initializeApp(); // Application Default Credentials — works in Firebase App Hosting automatically
  }
  return getApp();
}

export function getAdminAuth(): Auth {
  return getAuth(ensureAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(ensureAdminApp());
}
