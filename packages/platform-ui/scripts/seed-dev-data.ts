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
 * The server-side data layer is Postgres. The Firestore emulator still backs
 * the `users` collection that the server-side user-profile read port + invite
 * service depend on (Auth-adjacent, out of ADR-0001 scope). The namespace /
 * member / workflow-def Firestore seeds are now redundant with the Postgres
 * seed and pending cleanup.
 */

import { clearEmulators, createTestUser, seedCollection, seedSubcollection } from '../e2e/helpers/emulator';
import { buildSeedData } from '../e2e/helpers/seed-data';
import { seedPostgresNamespace } from '../e2e/helpers/postgres-seed';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';
const TEST_ORG_HANDLE = 'test-org';

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

    // 4. Seed the UI-realtime Firestore collections
    console.log('Seeding UI-realtime Firestore collections:');
    const collections = [
      ['users', data.users],
      ['workflowDefinitions', data.workflowDefinitions],
      ['namespaces', data.namespaces],
    ] as const;

    for (const [name, docs] of collections) {
      await seedCollection(name, docs);
      console.log(`  ${name} (${Object.keys(docs).length} docs)`);
    }

    await seedSubcollection('namespaces', TEST_ORG_HANDLE, 'members', data.namespaceMembers);
    console.log(`  namespaces/${TEST_ORG_HANDLE}/members (${Object.keys(data.namespaceMembers).length} docs)`);

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
