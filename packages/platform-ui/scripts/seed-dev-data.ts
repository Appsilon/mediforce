#!/usr/bin/env npx tsx
/**
 * Seed demo data for local development.
 * 
 * Usage:
 *   pnpm seed:dev
 * 
 * Requires:
 *   - Firebase emulators running (Auth on 9099, Firestore on 8080)
 *   - NEXT_PUBLIC_USE_EMULATORS=true
 */

import { buildSeedData } from '../e2e/helpers/seed-data.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-mediforce';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const API_KEY = 'fake-api-key-for-emulators';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';
const TEST_ORG_HANDLE = 'test-org';

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toFirestoreFields(doc: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function clearEmulators() {
  console.log('Clearing emulator state...');
  await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
  await fetch(
    `${FIRESTORE_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
}

async function createTestUser(): Promise<string> {
  console.log(`Creating test user: ${TEST_EMAIL}`);
  
  const signUpRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, displayName: TEST_DISPLAY_NAME, returnSecureToken: true }),
    },
  );

  if (signUpRes.ok) {
    const data = await signUpRes.json();
    return (data as { localId: string }).localId;
  }

  // User may already exist — sign in instead
  const signInRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true }),
    },
  );
  
  if (!signInRes.ok) {
    throw new Error(`Failed to create or sign in user: ${await signInRes.text()}`);
  }
  
  const data = await signInRes.json();
  return (data as { localId: string }).localId;
}

async function seedCollection(
  collection: string,
  documents: Record<string, Record<string, unknown>>,
) {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  
  for (const [docId, docData] of Object.entries(documents)) {
    const res = await fetch(`${basePath}/${collection}/${encodeURIComponent(docId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: toFirestoreFields(docData) }),
    });
    
    if (!res.ok) {
      throw new Error(`Failed to seed ${collection}/${docId}: ${await res.text()}`);
    }
  }
  
  console.log(`  ✓ ${collection} (${Object.keys(documents).length} documents)`);
}

async function seedSubcollection(
  parentCollection: string,
  parentId: string,
  subcollection: string,
  documents: Record<string, Record<string, unknown>>,
) {
  const basePath = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  
  for (const [docId, docData] of Object.entries(documents)) {
    const res = await fetch(
      `${basePath}/${parentCollection}/${parentId}/${subcollection}/${docId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFirestoreFields(docData) }),
      },
    );
    
    if (!res.ok) {
      throw new Error(`Failed to seed ${parentCollection}/${parentId}/${subcollection}/${docId}: ${await res.text()}`);
    }
  }
  
  console.log(`  ✓ ${parentCollection}/${parentId}/${subcollection} (${Object.keys(documents).length} documents)`);
}

async function main() {
  console.log('\n🌱 Seeding development data...\n');
  
  try {
    // 1. Clear existing data
    await clearEmulators();
    
    // 2. Create test user
    const testUserId = await createTestUser();
    console.log(`  ✓ User created: ${testUserId}\n`);
    
    // 3. Build seed data
    console.log('Building seed data...');
    const data = buildSeedData(testUserId);
    console.log(`  ✓ Data built for user: ${testUserId}\n`);
    
    // 4. Seed all collections
    console.log('Seeding collections:');
    await seedCollection('users', data.users);
    await seedCollection('humanTasks', data.humanTasks);
    await seedCollection('processInstances', data.processInstances);
    await seedCollection('agentRuns', data.agentRuns);
    await seedCollection('auditEvents', data.auditEvents);
    await seedCollection('processDefinitions', data.processDefinitions);
    await seedCollection('processConfigs', data.processConfigs);
    await seedCollection('workflowDefinitions', data.workflowDefinitions);
    await seedCollection('agentDefinitions', data.agentDefinitions);
    await seedCollection('namespaces', data.namespaces);
    await seedCollection('coworkSessions', data.coworkSessions);
    
    await seedSubcollection('processInstances', 'proc-running-1', 'stepExecutions', data.stepExecutions);
    await seedSubcollection('processInstances', 'proc-human-waiting', 'stepExecutions', data.humanWaitingStepExecutions);
    await seedSubcollection('processInstances', 'proc-completed-1', 'stepExecutions', data.completedProcessStepExecutions);
    await seedSubcollection('processInstances', 'proc-completed-2', 'stepExecutions', data.completedSupplyChainStepExecutions);
    await seedSubcollection('namespaces', TEST_ORG_HANDLE, 'members', data.namespaceMembers);
    
    console.log('\n✅ Development data seeded successfully!\n');
    console.log('Demo credentials:');
    console.log(`  Email: ${TEST_EMAIL}`);
    console.log(`  Password: ${TEST_PASSWORD}`);
    console.log('');
  } catch (error) {
    console.error('\n❌ Failed to seed data:', error);
    process.exit(1);
  }
}

main();