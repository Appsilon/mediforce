import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { getPageErrors, trackPageErrors } from '../helpers/page-errors';

test.describe('Workflow share-by-link journey', () => {
  test('shares a workflow by link after explaining its visibility', async ({ page }) => {
    trackPageErrors(page);
    const reset = await page.request.patch(
      `/api/workflow-definitions/${encodeURIComponent('Share by Link Test')}?namespace=${TEST_ORG_HANDLE}`,
      { data: { visibility: 'private' } },
    );
    expect(reset.status(), await reset.text()).toBe(200);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Share%20by%20Link%20Test`);

    await expect(page.getByText('Private', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Workflow actions' }).click();
    await page.getByRole('button', { name: 'Share by link...' }).click();

    await expect(page.getByRole('heading', { name: 'Share workflow by link' })).toBeVisible();
    await expect(page.getByText(/will not appear in other workspaces' workflow lists/i)).toBeVisible();
    await expect(page.getByText(/workflow runs remain private/i)).toBeVisible();

    await page.getByRole('button', { name: 'Share workflow' }).click();
    await expect(page.getByText('Shared by link', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(
      `${new URL(page.url()).origin}/${TEST_ORG_HANDLE}/workflows/Share%20by%20Link%20Test`,
    );

    await page.getByRole('button', { name: 'Workflow actions' }).click();
    await page.getByRole('button', { name: 'Make private' }).click();
    await expect(page.getByText('Private', { exact: true })).toBeVisible();
    expect(getPageErrors(page)).toEqual([]);
  });
});
