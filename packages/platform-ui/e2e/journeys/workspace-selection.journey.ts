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

  test('picker always shows when no default workspace is set', async ({ page }, testInfo) => {
    await setupRecording(page, 'workspace-selection-no-default', testInfo);

    await page.addInitScript(() => {
      localStorage.removeItem('alwaysNamespace');
    });

    await page.goto('/workspace-selection');
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    // Both workspace cards are visible with their "Set as default" checkboxes unchecked
    await expect(page.getByText('My workspace')).toBeVisible();
    await expect(page.getByText('Acme Labs')).toBeVisible();
    const defaultCheckboxes = page.getByRole('checkbox', { name: /set as default/i });
    await expect(defaultCheckboxes.first()).not.toBeChecked();
    await showStep(page);

    // Clicking a workspace card navigates there without setting a permanent default
    await click(page, page.getByRole('button').filter({ hasText: 'Acme Labs' }));
    await page.waitForURL('**/acme-labs**', { timeout: 10_000 });
    await showResult(page);

    // Returning to /workspace-selection still shows the picker because no default was saved
    await page.goto('/workspace-selection');
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    await endRecording(page);
  });

  test('setting default workspace via settings toggle auto-redirects on next visit', async ({ page }, testInfo) => {
    await setupRecording(page, 'workspace-selection-default-via-settings', testInfo);

    // Navigate first, then clear localStorage once via evaluate — addInitScript would
    // re-run before every navigation and wipe the value the toggle saves.
    await page.goto('/acme-labs');
    await page.evaluate(() => localStorage.removeItem('alwaysNamespace'));
    await expect(page.getByRole('heading', { name: 'Acme Labs' })).toBeVisible({ timeout: 15_000 });
    await showStep(page);

    // Click the Settings link (cog + "Settings" text, visible to all users)
    await click(page, page.getByRole('link', { name: 'Settings' }));
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Find the Default workspace toggle in the Preferences section and enable it
    const toggle = page.getByRole('switch', { name: /set as default workspace/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-state', 'unchecked');
    await showCaption(page, 'Enabling default workspace…');
    await click(page, toggle);
    await expect(toggle).toHaveAttribute('data-state', 'checked');
    await showResult(page);

    // Visiting /workspace-selection now skips the picker and goes straight to acme-labs
    await page.goto('/workspace-selection');
    await page.waitForURL('**/acme-labs**', { timeout: 10_000 });
    await expect(page.getByText('Choose a workspace to continue')).not.toBeVisible();
    await showResult(page);
    await showCaption(page, 'Redirected directly — no picker shown');

    await endRecording(page);
  });
});
