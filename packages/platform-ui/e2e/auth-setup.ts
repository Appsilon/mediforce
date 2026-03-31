import { test as setup } from '@playwright/test';
import { TEST_ORG_HANDLE } from './helpers/constants';
import { clearEmulators, createTestUser, seedCollection, seedSubcollection } from './helpers/emulator';
import { buildSeedData } from './helpers/seed-data';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

setup('authenticate and seed data', async ({ page }) => {
  setup.setTimeout(120_000);

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
  await seedCollection('workflowMeta', data.workflowMeta);
  await seedCollection('agentDefinitions', data.agentDefinitions);
  await seedCollection('namespaces', data.namespaces);
  await seedSubcollection('namespaces', TEST_ORG_HANDLE, 'members', data.namespaceMembers);
  await seedSubcollection('processInstances', 'proc-completed-1', 'stepExecutions', data.completedProcessStepExecutions);
  await seedSubcollection('processInstances', 'proc-completed-2', 'stepExecutions', data.completedSupplyChainStepExecutions);

  // 4. Sign in via test-login page to capture auth state
  // First load warms up Next.js compilation — allow extra time.
  // In environments without internet, Google Font downloads fail and cause Next.js
  // Fast Refresh which can disrupt the sign-in flow. We retry to handle this.
  await page.goto('/test-login', { timeout: 60_000 });

  // Pre-warm the /redirect route so compilation doesn't trigger Fast Refresh during navigation
  const preWarmCtx = await page.context().newPage();
  await preWarmCtx.goto('/redirect', { timeout: 60_000 }).catch(() => {});
  await preWarmCtx.close();

  let signedIn = false;
  for (let attempt = 0; attempt < 3 && !signedIn; attempt++) {
    if (attempt > 0) {
      // After Fast Refresh, re-navigate to test-login
      await page.goto('/test-login', { timeout: 30_000 });
    }

    await page.fill('input[name="email"]', TEST_EMAIL);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');

    try {
      await page.waitForURL(`**/${TEST_ORG_HANDLE}`, { timeout: 30_000 });
      signedIn = true;
    } catch {
      // Sign-in may have been disrupted by Fast Refresh — retry
    }
  }

  if (!signedIn) {
    throw new Error('Failed to sign in after 3 attempts — check emulator connectivity and Fast Refresh logs');
  }

  // 5. Save auth state for reuse by authenticated tests
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
