#!/usr/bin/env npx tsx
/**
 * Seed demo data for local development.
 *
 * Usage:
 *   pnpm seed:dev
 *
 * Requires:
 *   - Firebase Auth emulator running (port 9099)
 *   - Postgres running with the latest migrations applied (`pnpm db:migrate`)
 *
 * The server-side data layer is Postgres (seeded via seedPostgresNamespace).
 * The Firestore emulator only backs the `users` collection that the
 * server-side user-profile read port + invite service depend on
 * (Auth-adjacent, out of ADR-0001 scope).
 */

import { clearEmulators, createTestUser, seedCollection } from '../e2e/helpers/emulator';
import { buildSeedData } from '../e2e/helpers/seed-data';
import { seedPostgresNamespace } from '../e2e/helpers/postgres-seed';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

async function main() {
  console.log('\nSeeding development data...\n');

  try {
    // 1. Clear existing data
    await clearEmulators();

    // 2. Create test user
    const testUserId = await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);
    console.log(`  User created: ${testUserId}\n`);

    // 3. Build seed data
    const data = buildSeedData(testUserId);

    // 4. Seed the Firestore `users` collection (still read by the server-side
    // user-profile read port + invite service; Auth-adjacent, out of ADR-0001
    // scope). Everything else lives in Postgres — mirrored below.
    await seedCollection('users', data.users);
    console.log(`  users (${Object.keys(data.users).length} docs)`);

    // 5. Mirror fixture into Postgres (server-side data layer).
    console.log('\nMirroring fixture to Postgres:');
    await seedPostgresNamespace(testUserId);
    console.log('  Postgres seed complete');

    console.log('\nDevelopment data seeded successfully!\n');
    console.log('Demo credentials:');
    console.log(`  Email: ${TEST_EMAIL}`);
    console.log(`  Password: ${TEST_PASSWORD}`);
    console.log('');
  } catch (error) {
    console.error('\nFailed to seed data:', error);
    process.exit(1);
  }
}

main();
