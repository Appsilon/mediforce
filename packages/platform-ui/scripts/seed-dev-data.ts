#!/usr/bin/env npx tsx
/**
 * Seed demo data for local development.
 *
 * Usage:
 *   pnpm seed:dev
 *
 * Requires:
 *   - Firebase emulators running (Auth on 9099, Firestore on 8080)
 */

import { clearEmulators, createTestUser, seedCollection, seedSubcollection } from '../e2e/helpers/emulator.js';
import { buildSeedData } from '../e2e/helpers/seed-data.js';

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

    // 4. Seed all collections
    console.log('Seeding collections:');
    const collections = [
      ['users', data.users],
      ['humanTasks', data.humanTasks],
      ['processInstances', data.processInstances],
      ['agentRuns', data.agentRuns],
      ['auditEvents', data.auditEvents],
      ['processDefinitions', data.processDefinitions],
      ['processConfigs', data.processConfigs],
      ['workflowDefinitions', data.workflowDefinitions],
      ['namespaces', data.namespaces],
      ['coworkSessions', data.coworkSessions],
    ] as const;

    for (const [name, docs] of collections) {
      await seedCollection(name, docs);
      console.log(`  ${name} (${Object.keys(docs).length} docs)`);
    }

    const subcollections = [
      ['processInstances', 'proc-running-1', 'stepExecutions', data.stepExecutions],
      ['processInstances', 'proc-human-waiting', 'stepExecutions', data.humanWaitingStepExecutions],
      ['processInstances', 'proc-completed-1', 'stepExecutions', data.completedProcessStepExecutions],
      ['processInstances', 'proc-completed-2', 'stepExecutions', data.completedSupplyChainStepExecutions],
      ['namespaces', TEST_ORG_HANDLE, 'members', data.namespaceMembers],
    ] as const;

    for (const [parent, parentId, sub, docs] of subcollections) {
      await seedSubcollection(parent, parentId, sub, docs);
      console.log(`  ${parent}/${parentId}/${sub} (${Object.keys(docs).length} docs)`);
    }

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
