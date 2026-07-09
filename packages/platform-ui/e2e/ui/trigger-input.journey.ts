import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Trigger Input Journey', () => {
  test('start run dialog shows input form, validates required fields, and starts run', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Trigger%20Input%20Test`);
    await expect(page.getByText('Trigger Input Test')).toBeVisible({ timeout: 10_000 });

    // Click Start Run — dialog opens with "Run input" title
    await page.getByRole('button', { name: /start run/i }).click();
    await expect(page.getByText('Run input')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Study identifier')).toBeVisible();
    await expect(page.getByText('Run priority')).toBeVisible();
    await expect(page.getByText('Dry run mode').first()).toBeVisible();

    // Start button disabled — studyId is required and empty
    const startButton = page.getByRole('button', { name: /start run$/i }).last();
    await expect(startButton).toBeDisabled();

    // Default values pre-filled: priority=normal, dryRun=false
    const prioritySelect = page.locator('select');
    await expect(prioritySelect).toHaveValue('normal');

    // Fill required field
    await page.locator('input[type="text"]').fill('STUDY-001');

    // Start button now enabled
    await expect(startButton).toBeEnabled();

    // Change optional fields
    await prioritySelect.selectOption('high');
    await page.getByRole('checkbox', { name: /dry run/i }).click();

    // Click Start run
    await startButton.click();

    // Run created — verify on workflow page (run visible in list)
    await expect(page).toHaveURL(/Trigger%20Input%20Test/, { timeout: 30_000 });
    // Phase 4 (PR #591) replaced Firestore push with react-query polling
    // (CRITICAL LIVE 1.5 s per ADR-0006 §4). The `Trigger Input Test`
    // workflow's first step is `executor: human`, so the run transitions
    // `created` → `running` → `paused (waiting_for_human)` and the
    // `created` / `running` window collapses inside one poll on MOCK_AGENT
    // runs. Assert against either the transient "In Progress" badge or
    // the steady-state "Waiting for human" badge — both prove the run
    // started successfully.
    await expect(
      page.getByText(/In Progress|Waiting for human/).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('cancel dialog without starting', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Trigger%20Input%20Test`);
    await expect(page.getByText('Trigger Input Test')).toBeVisible({ timeout: 10_000 });

    // Open dialog
    await page.getByRole('button', { name: /start run/i }).click();
    await expect(page.getByText('Run input')).toBeVisible({ timeout: 5_000 });

    // Cancel
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Run input')).not.toBeVisible();
  });
});
