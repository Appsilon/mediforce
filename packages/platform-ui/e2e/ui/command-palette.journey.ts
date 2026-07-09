import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

test.describe('Command Palette Journey', () => {
  test('opens via shortcut, files a bug ticket, and shows success toast', async ({ page }) => {
    trackPageErrors(page);

    // Intercept the tickets API so the test doesn't need a real GitHub token.
    await page.route('**/api/tickets', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ number: 142, url: 'https://github.com/appsilon/mediforce/issues/142' }),
      });
    });

    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 });

    // Header badge is visible
    await expect(page.getByTestId('command-palette-trigger')).toBeVisible();

    // Open palette via keyboard shortcut (Ctrl+K works on every OS in Playwright)
    await page.keyboard.press('Control+KeyK');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await expect(page.getByTestId('command-palette-input')).toBeFocused();

    // Select "New ticket"
    await page.getByTestId('command-new-ticket').click();
    await expect(page.getByTestId('new-ticket-form')).toBeVisible();

    // Context chips present: filed-by (non-removable) + url (removable)
    await expect(page.getByTestId('ticket-chip-filed-by')).toBeVisible();
    await expect(page.getByTestId('ticket-chip-url')).toBeVisible();

    // Switch to Idea and back to Bug to verify templates
    await page.getByTestId('ticket-type-idea').click();
    await expect(page.getByTestId('ticket-description-input')).toHaveValue(/Problem:/);
    await page.getByTestId('ticket-type-bug').click();
    await expect(page.getByTestId('ticket-description-input')).toHaveValue(/Steps to reproduce:/);

    // Remove URL chip
    await page.getByTestId('ticket-chip-remove-url').click();
    await expect(page.getByTestId('ticket-chip-url')).toHaveCount(0);

    // Fill the form
    await page.getByTestId('ticket-title-input').fill('Reproduction: filter drops selected rows');

    // Submit
    await page.getByTestId('ticket-submit').click();

    // Palette closes, toast appears
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    const toast = page.getByTestId('toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.getByText('Ticket #142 created')).toBeVisible();
    await expect(toast.getByRole('link', { name: /view on github/i })).toBeVisible();
  });

  test('? opens the keyboard shortcuts overlay', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await expect(page.getByTestId('shortcuts-view')).toBeVisible();
    await expect(page.getByText('Open command palette')).toBeVisible();
    await expect(page.getByText('Show keyboard shortcuts')).toBeVisible();
  });
});
