/**
 * CLI entry point for seeding Firestore with supply intelligence data.
 *
 * Usage:
 *   pnpm seed                                         # seeds with default project
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm seed  # seeds emulator
 *
 * Uses the Firebase client SDK (no admin credentials needed).
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { seedSupplyData } from './seed-firestore.js';

const app = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-mediforce' });
const db = getFirestore(app, 'supply-intelligence');

if (process.env.FIRESTORE_EMULATOR_HOST) {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, parseInt(port, 10));
  console.log(`Connected to Firestore emulator at ${host}:${port}`);
}

try {
  await seedSupplyData(db);
  console.log('Seed completed successfully.');
  process.exit(0);
} catch (error) {
  console.error('Seed failed:', error);
  process.exit(1);
}
