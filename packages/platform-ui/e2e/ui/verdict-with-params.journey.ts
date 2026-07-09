import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Verdict With Params Journey', () => {
  test('reviewer fills required params then submits a verdict', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-param-verdict-target`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Assessment' })).toBeVisible({ timeout: 10_000 });

    // Verdict buttons are blocked until required fields are filled
    await expect(page.getByText('Fill required fields first').first()).toBeVisible();

    // Fill the required findings field (first textbox in the param section)
    await page.locator('label:has-text("findings")').locator('..').locator('input[type="text"]').fill('No critical issues identified');

    // Submit verdict — single click, no secondary confirmation step
    await page.getByRole('button', { name: /^Approve$/ }).click();
    await expect(page.getByText('Submitted: Approve')).toBeVisible({ timeout: 15_000 });
  });

  test('completed task shows param values in read-only verdict card', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks/task-param-verdict-completed`);
    await expect(page.getByRole('heading', { name: 'Supply Chain Assessment' })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('Submitted: Approve')).toBeVisible();
    await expect(page.getByText('All vendor checks passed')).toBeVisible();
  });
});
