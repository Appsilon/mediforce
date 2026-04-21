import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, showCaption, endRecording } from '../helpers/recording';

test.describe('Command Palette Journey', () => {
  test('opens via shortcut, files a bug ticket, and shows success toast', async ({ page }, testInfo) => {
    await setupRecording(page, 'command-palette-new-ticket', testInfo);

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
    await showCaption(page, 'Anywhere in the app — press ⌘K to open the command palette');

    // Header badge is visible
    await expect(page.getByTestId('command-palette-trigger')).toBeVisible();
    await showStep(page);

    // Open palette via keyboard shortcut (Ctrl+K works on every OS in Playwright)
    await page.keyboard.press('Control+KeyK');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await expect(page.getByTestId('command-palette-input')).toBeFocused();
    await showCaption(page, 'Type a command or search…');
    await showStep(page);

    // Select "New ticket"
    await click(page, page.getByTestId('command-new-ticket'));
    await expect(page.getByTestId('new-ticket-form')).toBeVisible();
    await showCaption(page, 'Pick type, write a title — we auto-attach the current page and filer');

    // Context chips present: filed-by (non-removable) + url (removable)
    await expect(page.getByTestId('ticket-chip-filed-by')).toBeVisible();
    await expect(page.getByTestId('ticket-chip-url')).toBeVisible();
    await showStep(page);

    // Switch to Idea and back to Bug to verify templates
    await click(page, page.getByTestId('ticket-type-idea'));
    await expect(page.getByTestId('ticket-description-input')).toHaveValue(/Problem:/);
    await click(page, page.getByTestId('ticket-type-bug'));
    await expect(page.getByTestId('ticket-description-input')).toHaveValue(/Steps to reproduce:/);

    // Remove URL chip
    await click(page, page.getByTestId('ticket-chip-remove-url'));
    await expect(page.getByTestId('ticket-chip-url')).toHaveCount(0);
    await showCaption(page, 'Context chips are removable — keep only what you want');
    await showStep(page);

    // Fill the form
    await page.getByTestId('ticket-title-input').fill('Reproduction: filter drops selected rows');
    await showStep(page);

    // Submit
    await click(page, page.getByTestId('ticket-submit'));
    await showCaption(page, 'Toast confirms the issue number, with a link to GitHub');

    // Palette closes, toast appears
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    const toast = page.getByTestId('toast');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast.getByText('Ticket #142 created')).toBeVisible();
    await expect(toast.getByRole('link', { name: /view on github/i })).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });

  test('? opens the keyboard shortcuts overlay', async ({ page }, testInfo) => {
    await setupRecording(page, 'command-palette-shortcuts', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Press ? anywhere to see all keyboard shortcuts');

    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await expect(page.getByTestId('shortcuts-view')).toBeVisible();
    await expect(page.getByText('Open command palette')).toBeVisible();
    await expect(page.getByText('Show keyboard shortcuts')).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
