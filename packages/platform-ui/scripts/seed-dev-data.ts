#!/usr/bin/env npx tsx
/**
 * Seed demo data for local development.
 *
 * Usage:
 *   pnpm seed:dev
 *
 * Requires:
 *   - Postgres running with the latest migrations applied (`pnpm db:migrate`),
 *     reachable via DATABASE_URL
 *
 * Everything lives in Postgres: identity in `auth_users` (ADR-0002) and the
 * workspace fixture in the domain tables (ADR-0001 #534).
 */

import { createTestUser } from '../e2e/helpers/emulator';
import { seedPostgresNamespace } from '../e2e/helpers/postgres-seed';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

async function main() {
  console.log('\nSeeding development data...\n');

  try {
    // 1. Upsert the `auth_users` row with a bcrypt password hash so the
    // NextAuth Credentials provider (`ENABLE_PASSWORD_AUTH=true`) can sign in.
    const testUserId = await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);
    console.log(`  User created: ${testUserId}\n`);

    // 2. Seed the full fixture into Postgres (the server-side data layer).
    console.log('Seeding Postgres:');
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
