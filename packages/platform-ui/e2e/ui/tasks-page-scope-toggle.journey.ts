import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE, TEST_USER_DISPLAY_NAME } from '../helpers/constants';
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
    // The page opens scoped to the workspace in the URL, so the wide view is
    // "every action in the selection" — not the cross-workspace roll-up, which
    // is what the workspace filter's "All workspaces" asks for.
    await expect(page.getByText(/Every action in the selected workspaces/)).toBeVisible();
  });

  test('the workspace filter opens on the workspace in the URL and can widen to all', async ({
    page,
  }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    await expect(page.getByRole('heading', { name: 'Human actions' })).toBeVisible({
      timeout: 30_000,
    });

    // Default: the one workspace the reader navigated to, named on the trigger.
    // The trigger carries a fixed accessible name because its visible label is
    // the current selection — matching on the label would follow the state the
    // test is about to change.
    const filter = page.getByRole('button', { name: 'Filter by workspace' });
    // TEST_ORG_HANDLE is the test user's personal workspace, so it is named
    // after them.
    await expect(filter).toHaveText(TEST_USER_DISPLAY_NAME);

    await page.getByRole('button', { name: 'All in workspace' }).click();
    await filter.click();
    await page.getByRole('button', { name: 'All workspaces' }).click();

    await expect(page.getByText(/Every action in the workspaces you belong to/)).toBeVisible();
  });
});
