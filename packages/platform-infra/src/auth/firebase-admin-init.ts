import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
}

export type CredentialMode =
  | 'emulator'
  | 'ADC (gcloud)'
  | 'service account file'
  | 'GCP metadata'
  | 'none';

function adcFilePath(): string {
  return join(homedir(), '.config', 'gcloud', 'application_default_credentials.json');
}

function inGcpEnvironment(): boolean {
  return Boolean(
    process.env.K_SERVICE ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT,
  );
}

export function detectCredentialMode(): CredentialMode {
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') return 'emulator';
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return 'service account file';
  if (existsSync(adcFilePath())) return 'ADC (gcloud)';
  if (inGcpEnvironment()) return 'GCP metadata';
  return 'none';
}

export function assertCredentialsPresent(): void {
  if (detectCredentialMode() !== 'none') return;
  throw new Error(
    [
      'Firebase Admin SDK: no credentials detected.',
      'Pick one of:',
      '  a) gcloud auth application-default login   (local dev — recommended)',
      '  b) GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json   (CI)',
      '  c) NEXT_PUBLIC_USE_EMULATORS=true pnpm dev:local   (offline / tests)',
      'See docs/development.md#firebase-credentials.',
    ].join('\n'),
  );
}

function ensureAdminApp() {
  if (!getApps().length) {
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true') {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-mediforce',
      });
    } else {
      assertCredentialsPresent();
      initializeApp();
    }
  }
  return getApp();
}

export function getAdminAuth(): Auth {
  return getAuth(ensureAdminApp());
}

export function getAdminFirestore(): Firestore {
  return getFirestore(ensureAdminApp());
}
