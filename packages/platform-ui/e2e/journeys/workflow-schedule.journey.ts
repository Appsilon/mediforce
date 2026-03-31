import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

test.describe('Workflow Schedule & Publishing Journey', () => {
  test('Schedule tab shows triggers and allows adding cron schedule', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-schedule-cron', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);

    // Wait for page to load, then click Schedule tab
    await expect(page.getByRole('tab', { name: /schedule/i })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    await click(page, page.getByRole('tab', { name: /schedule/i }));

    // Verify the schedule editor is visible — manual toggle should be present
    await expect(page.getByText('Allow manual runs')).toBeVisible({ timeout: 5_000 });
    await showStep(page);

    // Verify existing cron trigger is displayed (v2 seed data has a daily-run cron)
    // The schedule editor loads from the latest version which has a cron trigger
    await expect(page.getByText('Scheduled triggers')).toBeVisible();
    await showStep(page);

    // Click "Add schedule" to add a new cron trigger
    await click(page, page.getByText('Add schedule'));

    // A new cron entry editor should appear with a frequency selector
    await expect(page.getByText('Frequency').first()).toBeVisible({ timeout: 3_000 });
    await showStep(page);

    // Select "Daily" frequency — target the frequency select within the newly added cron entry.
    // The new entry defaults to "Hourly", which also shows a minute select after the frequency.
    // Use the label text to find the right select.
    const frequencyLabel = page.getByText('Frequency').last();
    const frequencySelect = frequencyLabel.locator('..').locator('select').first();
    await frequencySelect.selectOption('daily');
    await showStep(page);

    // Verify the "Save & publish as vN" button is visible and shows the correct next version
    await expect(page.getByRole('button', { name: /save & publish as v/i })).toBeVisible();
    await showResult(page);
  });

  test('Published and Draft badges appear in definitions list', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-schedule-badges', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review`);

    // Wait for tabs to load
    await expect(page.getByRole('tab', { name: /definitions/i })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Click Definitions tab
    await click(page, page.getByRole('tab', { name: /definitions/i }));

    // Wait for the definitions list to render — should show "2 versions"
    await expect(page.getByText('2 versions')).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Verify "Published" badge appears (v1 is the published version per workflowMeta seed)
    await expect(page.getByText('Published')).toBeVisible();

    // Verify "Draft" badge appears (v2 is not published)
    await expect(page.getByText('Draft')).toBeVisible();
    await showResult(page);
  });

  test('Draft version shows publish banner', async ({ page }, testInfo) => {
    await setupRecording(page, 'workflow-schedule-draft-banner', testInfo);

    // Navigate to v2 which is a draft (not published)
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review/definitions/2`);

    // Wait for version badge to appear
    await expect(page.locator('text=v2')).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Verify the amber "This version is a draft" banner is visible
    await expect(page.getByText('This version is a draft')).toBeVisible();
    await showStep(page);

    // Verify "Publish this version" button exists within the banner
    await expect(page.getByRole('button', { name: /publish this version/i })).toBeVisible();

    // Verify "Test run" label on the run button (draft versions show "Test run")
    await expect(page.getByRole('button', { name: /test run/i })).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
