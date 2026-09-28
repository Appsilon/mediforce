import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Guided Tour Journey', () => {
  test('Guide walks the current page', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId('guide-trigger')).toBeVisible();

    await page.getByTestId('guide-trigger').click();
    const card = page.getByTestId('tour-card');
    await expect(card).toBeVisible();
    await expect(card.getByText(/^1 of \d+$/)).toBeVisible();
    await expect(card.getByText(/Guide · This workspace/)).toBeVisible();

    // Back is unusable on the first step, Next advances, the last step closes.
    await expect(card.getByRole('button', { name: 'Back' })).toBeDisabled();
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card.getByText(/^2 of \d+$/)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Back' })).toBeEnabled();

    // Walk to the end, whatever the chapter's length, and close from there.
    const total = Number((await card.getByText(/^\d+ of \d+$/).innerText()).split(' of ')[1]);
    for (let step = 2; step < total; step += 1) {
      await card.getByRole('button', { name: 'Next' }).click();
    }
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
  });

  test('the guide is page-specific and Escape ends it', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'Human actions' })).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('guide-trigger').click();
    await expect(page.getByTestId('tour-card').getByText(/Guide · Human actions/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tour-overlay')).toHaveCount(0);
  });

  test('Demo offers its scenarios to anyone in a workspace', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('demo-trigger').click();
    await expect(page.getByTestId('demo-scenarios')).toBeVisible();
    await expect(page.getByTestId('demo-scenario-run')).toBeVisible();
  });

  /**
   * `?tab=` has to drive a mounted page, not just seed its initial state —
   * otherwise a demo step that deep-links a tab lands on Runs, and so does
   * every back/forward across tabs.
   */
  test('a workflow tab can be deep-linked and survives back/forward', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review?tab=triggers`);
    await expect(page.getByRole('heading', { name: 'Input' })).toBeVisible({ timeout: 15_000 });

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/Supply%20Chain%20Review?tab=access`);
    await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Input' })).toBeVisible();
  });
});
