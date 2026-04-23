import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, patchDocumentFields, seedCollection, seedSubcollection } from '../helpers/emulator';
import { setupRecording, click, showStep, showResult, showCaption, endRecording } from '../helpers/recording';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

test.describe('Workspace Selection Journey', () => {
  test.beforeAll(async () => {
    // createTestUser signs in if the user already exists (auth-setup creates them)
    const uid = await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);

    await seedCollection('namespaces', {
      'acme-labs': {
        handle: 'acme-labs',
        type: 'organization',
        displayName: 'Acme Labs',
        createdAt: new Date().toISOString(),
      },
    });
    await seedSubcollection('namespaces', 'acme-labs', 'members', {
      [uid]: { uid, role: 'owner', joinedAt: new Date().toISOString() },
    });
    await patchDocumentFields('users', uid, { organizations: ['acme-labs'] });
  });

  test('user sees workspace picker and selects an org workspace', async ({ page }, testInfo) => {
    await setupRecording(page, 'workspace-selection', testInfo);

    // Clear any stored default workspace so the picker is always shown
    await page.addInitScript(() => {
      localStorage.removeItem('workspace-default-key');
    });

    await page.goto('/workspace-selection');
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Choose a workspace to continue');

    // Both personal and org workspace cards are visible
    await expect(page.getByText('My workspace')).toBeVisible();
    await expect(page.getByText('Acme Labs')).toBeVisible();
    await showStep(page);

    await showCaption(page, 'Selecting Acme Labs workspace…');
    // Find the card button containing "Acme Labs" and click it
    await click(page, page.getByRole('button').filter({ hasText: 'Acme Labs' }));

    await page.waitForURL('**/acme-labs**', { timeout: 10_000 });
    await showResult(page);
    await showCaption(page, 'Entered Acme Labs workspace');
    await endRecording(page);
  });
});
