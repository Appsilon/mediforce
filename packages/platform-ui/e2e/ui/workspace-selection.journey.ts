import { test, expect } from '../helpers/test-fixtures';
import { createTestUser } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

const TEST_EMAIL = 'test@mediforce.dev';
const TEST_PASSWORD = 'test123456';
const TEST_DISPLAY_NAME = 'Test User';

test.describe('Workspace Selection Journey', () => {
  test.beforeAll(async () => {
    // createTestUser signs in if the user already exists (auth-setup creates them)
    const uid = await createTestUser(TEST_EMAIL, TEST_PASSWORD, TEST_DISPLAY_NAME);

    // Give the test user a second, org-kind workspace they own. The picker
    // then shows their personal "My workspace" alongside "Acme Labs". Org
    // membership derives from `workspace_members`, so the owner row is all
    // that's needed — the legacy `users/{uid}.organizations` array is gone.
    await seedPostgresOrganizationNamespace('acme-labs', uid, 'Acme Labs');
  });

  test('user sees workspace picker and selects an org workspace', async ({ page }) => {
    trackPageErrors(page);

    // Clear any stored default workspace so the picker is always shown
    await page.addInitScript(() => {
      localStorage.removeItem('workspace-default-key');
    });

    await page.goto('/workspace-selection');
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible({ timeout: 15_000 });

    // Both personal and org workspace cards are visible
    await expect(page.getByText('My workspace')).toBeVisible();
    await expect(page.getByText('Acme Labs')).toBeVisible();

    // Find the card button containing "Acme Labs" and click it
    await page.getByRole('button').filter({ hasText: 'Acme Labs' }).click();

    await page.waitForURL('**/acme-labs**', { timeout: 10_000 });
  });

  test('picker always shows when no default workspace is set', async ({ page }) => {
    trackPageErrors(page);

    await page.addInitScript(() => {
      localStorage.removeItem('alwaysNamespace');
    });

    await page.goto('/workspace-selection');
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible({ timeout: 15_000 });

    // Both workspace cards are visible with their "Set as default" checkboxes unchecked
    await expect(page.getByText('My workspace')).toBeVisible();
    await expect(page.getByText('Acme Labs')).toBeVisible();
    const defaultCheckboxes = page.getByRole('checkbox', { name: /set as default/i });
    await expect(defaultCheckboxes.first()).not.toBeChecked();

    // Clicking a workspace card navigates there without setting a permanent default
    await page.getByRole('button').filter({ hasText: 'Acme Labs' }).click();
    await page.waitForURL('**/acme-labs**', { timeout: 10_000 });

    // Returning to /workspace-selection still shows the picker because no default was saved
    await page.goto('/workspace-selection');
    await expect(page.getByText('Choose a workspace to continue')).toBeVisible({ timeout: 15_000 });
  });

  test('setting default workspace via settings toggle auto-redirects on next visit', async ({ page }) => {
    trackPageErrors(page);

    // Navigate first, then clear localStorage once via evaluate — addInitScript would
    // re-run before every navigation and wipe the value the toggle saves.
    await page.goto('/acme-labs');
    await page.evaluate(() => localStorage.removeItem('alwaysNamespace'));
    await expect(page.getByRole('heading', { name: 'Acme Labs' })).toBeVisible({ timeout: 15_000 });

    // Click the Settings link (cog + "Settings" text, visible to all users)
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({ timeout: 10_000 });

    // Find the Default workspace toggle in the Preferences section and enable it
    const toggle = page.getByRole('switch', { name: /set as default workspace/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-state', 'unchecked');
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-state', 'checked');

    // Visiting /workspace-selection now skips the picker and goes straight to acme-labs
    await page.goto('/workspace-selection');
    await page.waitForURL('**/acme-labs**', { timeout: 10_000 });
    await expect(page.getByText('Choose a workspace to continue')).not.toBeVisible();
  });
});
