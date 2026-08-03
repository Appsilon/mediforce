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
import {
  TEST_USER_DISPLAY_NAME,
  TEST_USER_EMAIL,
  TEST_USER_ID,
  TEST_USER_PASSWORD,
} from '../e2e/helpers/constants';

async function main() {
  console.log('\nSeeding development data...\n');

  try {
    // 1. Upsert the `auth_users` row with a bcrypt password hash so
    // `/api/auth/password-login` (`ENABLE_PASSWORD_AUTH=true`) can sign in.
    // Pinned to `TEST_USER_ID` — the same email under a random uuid would
    // collide with the E2E fixture's stable id on `auth_users_email_unique`.
    const testUserId = await createTestUser(
      TEST_USER_EMAIL,
      TEST_USER_PASSWORD,
      TEST_USER_DISPLAY_NAME,
      TEST_USER_ID,
    );
    console.log(`  User created: ${testUserId}\n`);

    // 2. Seed the full fixture into Postgres (the server-side data layer).
    console.log('Seeding Postgres:');
    await seedPostgresNamespace(testUserId);
    console.log('  Postgres seed complete');

    console.log('\nDevelopment data seeded successfully!\n');
    console.log('Demo credentials:');
    console.log(`  Email: ${TEST_USER_EMAIL}`);
    console.log(`  Password: ${TEST_USER_PASSWORD}`);
    console.log('');
  } catch (error) {
    console.error('\nFailed to seed data:', error);
    process.exit(1);
  }
}

main();
