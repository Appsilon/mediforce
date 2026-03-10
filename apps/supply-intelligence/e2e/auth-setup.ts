import { test as setup } from '@playwright/test';
import { clearEmulators, createTestUser, seedCollection } from './helpers/emulator';
import { buildSupplySeedData } from './helpers/seed-data';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

setup('authenticate and seed supply data', async ({ page }) => {
  // 1. Clear all emulator state
  await clearEmulators();

  // 2. Create test user
  await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);

  // 3. Seed Firestore with supply data
  const data = buildSupplySeedData();
  for (const [collectionName, docs] of Object.entries(data)) {
    await seedCollection(collectionName, docs);
  }

  // 4. Sign in via test-login page to capture auth state
  await page.goto('/test-login');
  await page.fill('input[name="email"]', TEST_EMAIL);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/overview**', { timeout: 15_000 });

  // 5. Save auth state for reuse by authenticated tests
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
