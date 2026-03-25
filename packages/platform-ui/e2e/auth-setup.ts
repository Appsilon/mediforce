import { test as setup } from '@playwright/test';
import { clearEmulators, createTestUser, seedCollection, seedSubcollection } from './helpers/emulator';
import { buildSeedData } from './helpers/seed-data';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

setup('authenticate and seed data', async ({ page }) => {
  // 1. Clear all emulator state
  await clearEmulators();

  // 2. Create test user and get UID
  const testUserId = await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);

  // 3. Seed Firestore with test data
  const data = buildSeedData(testUserId);
  await seedCollection('users', data.users);
  await seedCollection('humanTasks', data.humanTasks);
  await seedCollection('processInstances', data.processInstances);
  await seedCollection('agentRuns', data.agentRuns);
  await seedCollection('auditEvents', data.auditEvents);
  await seedSubcollection('processInstances', 'proc-running-1', 'stepExecutions', data.stepExecutions);
  await seedSubcollection('processInstances', 'proc-human-waiting', 'stepExecutions', data.humanWaitingStepExecutions);
  await seedCollection('processDefinitions', data.processDefinitions);
  await seedCollection('processConfigs', data.processConfigs);
  await seedCollection('workflowDefinitions', data.workflowDefinitions);
  await seedCollection('agentDefinitions', data.agentDefinitions);
  await seedCollection('namespaces', data.namespaces);
  await seedSubcollection('namespaces', 'test', 'members', data.namespaceMembers);
  await seedSubcollection('processInstances', 'proc-completed-1', 'stepExecutions', data.completedProcessStepExecutions);
  await seedSubcollection('processInstances', 'proc-completed-2', 'stepExecutions', data.completedSupplyChainStepExecutions);

  // 4. Sign in via test-login page to capture auth state
  await page.goto('/test-login');
  await page.fill('input[name="email"]', TEST_EMAIL);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/test', { timeout: 30_000 });

  // 5. Save auth state for reuse by authenticated tests
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
