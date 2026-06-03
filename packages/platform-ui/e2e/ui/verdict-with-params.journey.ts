import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showCaption, endRecording } from '../helpers/recording';

test.describe('Verdict With Params Journey', () => {
  test('reviewer fills required params then submits a verdict', async ({ page }, testInfo) => {
    await setupRecording(page, 'param-verdict-submit', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-param-verdict-target`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Assessment' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Task with required params and verdict buttons');

    // Verdict buttons are blocked until required fields are filled
    await expect(page.getByText('Fill required fields first').first()).toBeVisible();
    await showCaption(page, 'Verdict buttons locked — required field empty');

    // Fill the required findings field (first textbox in the param section)
    await page.locator('label:has-text("findings")').locator('..').locator('input[type="text"]').fill('No critical issues identified');
    await showCaption(page, 'Required field filled — verdict buttons unlocked');

    // Submit verdict — single click, no secondary confirmation step
    await click(page, page.getByRole('button', { name: /^Approve$/ }));
    await expect(page.getByText(/Submitted successfully/)).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Verdict submitted with param values', 3500);

    await endRecording(page);
  });

  test('completed task shows param values in read-only verdict card', async ({ page }, testInfo) => {
    await setupRecording(page, 'param-verdict-readonly', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-param-verdict-completed`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Assessment' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Completed task — read-only verdict card');

    await expect(page.getByText('Submitted: Approve')).toBeVisible();
    await expect(page.getByText('All vendor checks passed')).toBeVisible();
    await showCaption(page, 'Verdict and captured param values displayed', 3500);

    await endRecording(page);
  });
});
