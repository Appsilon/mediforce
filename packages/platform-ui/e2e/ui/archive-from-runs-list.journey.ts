import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

/**
 * Phase 4 PR3 — exercises the `useArchiveRun` mutation hook end-to-end:
 *
 *   1. From the workspace runs list, click "Archive run" on a completed row.
 *   2. The row disappears immediately (optimistic flip — `useArchiveRun`
 *      sets `archived: true` on the detail cache before the request returns;
 *      the list query then invalidates and refetches without the archived
 *      row because `showArchived` defaults to `false`).
 *   3. Toggle "Show archived" — the row reappears with the unarchive icon,
 *      proving the row was persisted (not just optimistically hidden) and
 *      that the showArchived client-side filter still scopes by namespace.
 *
 * Isolated seed: `proc-archive-target` is dedicated to this journey so
 * archiving it doesn't affect tests that read `proc-completed-1` /
 * `proc-completed-2`.
 */
test.describe('Archive run from list — useArchiveRun optimistic', () => {
  test('archive hides row immediately; show archived brings it back with unarchive icon', async ({ page }, testInfo) => {
    await setupRecording(page, 'archive-from-runs-list', testInfo);
    await page.goto(`/${TEST_ORG_HANDLE}/runs`);

    // Row visible by default — list query loaded. `data-run-id` is the
    // stable selector; the rendered id cell truncates to first 8 chars.
    const targetRow = page.locator('tr[data-run-id="proc-archive-target"]');
    await expect(targetRow).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Click the per-row archive button — `title="Archive run"` is the
    // accessible name (icon-only button, no text content).
    const archiveButton = targetRow.getByTitle('Archive run');
    await expect(archiveButton).toBeVisible();
    await click(page, archiveButton);

    // Row disappears: list query invalidates on `useArchiveRun.onSettled`,
    // refetches without archived rows (showArchived=false default).
    await expect(targetRow).toBeHidden({ timeout: 10_000 });
    await showStep(page);

    // Toggle "Show archived" — row reappears, this time with the
    // unarchive icon (title="Unarchive run") proving the archive persisted.
    await click(page, page.getByRole('button', { name: /show archived/i }));
    await expect(targetRow).toBeVisible({ timeout: 10_000 });
    await expect(targetRow.getByTitle('Unarchive run')).toBeVisible();
    await showResult(page);
    await endRecording(page);
  });
});
