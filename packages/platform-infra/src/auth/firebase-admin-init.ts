import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
}

function ensureAdminApp() {
  if (!getApps().length) {
    // Always pin projectId explicitly. Without this, Admin SDK falls back to
    // Application Default Credentials' default project, which on a dev
    // machine often points at a personal GCP project (e.g. whatever
    // `gcloud config get-value project` returns) — leading to silent 404s
    // against the expected Firebase project. In emulator mode the env var
    // might not be set, so keep the demo-mediforce fallback there.
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      ?? process.env.GOOGLE_CLOUD_PROJECT
      ?? (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' ? 'demo-mediforce' : undefined);
    initializeApp(projectId !== undefined ? { projectId } : {});
  }
  return getApp();
}

export function getAdminAuth(): Auth {
  return getAuth(ensureAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(ensureAdminApp());
}
