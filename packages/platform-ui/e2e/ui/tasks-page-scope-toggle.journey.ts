import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

// ─────────────────────────────────────────────────────────────────────────────
// Human actions defaults to the caller's own queue, and the workspace-wide
// view it used to show is one click away (#1251).
//
// Narrowing the default inbox is user-observable — someone who saw twelve
// tasks yesterday may see three today — so AGENTS.md §12 makes the toggle part
// of the feature, not a nicety. This journey is what proves it is really
// there and really switches the query; which tasks each scope contains is
// settled at L3 (`e2e/api/task-inbox-actionable.journey.ts`), where roles can
// be granted to more than one person.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Human actions scope toggle', () => {
  test('defaults to the caller’s own actions and switches to the whole workspace', async ({
    page,
  }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'Human actions' })).toBeVisible({
      timeout: 30_000,
    });

    const mine = page.getByRole('button', { name: 'For me' });
    const workspace = page.getByRole('button', { name: 'All in workspace' });

    await expect(mine).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Actions you can take/)).toBeVisible();

    await workspace.click();

    await expect(workspace).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/Every action in the workspaces you belong to/)).toBeVisible();
  });
});
