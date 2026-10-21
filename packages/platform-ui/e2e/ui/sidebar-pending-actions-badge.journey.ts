import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

// ─────────────────────────────────────────────────────────────────────────────
// The sidebar's "Human actions" item counts what is waiting on the caller —
// the same "For me" queue the tasks page opens on — so the reader sees there
// is work before opening the inbox.
//
// The exact number drifts as other journeys complete seeded tasks, so this
// asserts a positive count: `task-claimed-1` is claimed by the test user and
// no journey touches it.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Sidebar pending actions badge', () => {
  test('shows how many actions are waiting on the caller', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}`);

    const humanActions = page.getByRole('link', { name: /Human actions/ });
    const badge = humanActions.getByTestId('pending-actions-badge');
    await expect(badge).toHaveText(/^[1-9]\d*$/, { timeout: 30_000 });
  });
});
