import { test, expect } from '../helpers/test-fixtures';
import { setupRecording, click, showStep, showResult, showCaption, endRecording } from '../helpers/recording';

/**
 * Phase 4 PR4 — `POST /api/namespaces` with list-affecting optimistic prepend.
 *
 * The pre-seeded test user (auth-setup.ts) fills the create-workspace form,
 * submits, and lands on the new workspace home. The optimistic prepend should
 * make the new entry appear in the cached `['users','me']` bundle the moment
 * the mutation is fired; the server-echoed entity then replaces the placeholder
 * in `onSuccess`. The journey asserts the user-visible end state — redirect +
 * sidebar entry — rather than the internal cache transition.
 */
test.describe('Create workspace journey', () => {
  test('owner creates an organisation workspace and is redirected to it', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await setupRecording(page, 'create-workspace', testInfo);

    const suffix = Date.now().toString().slice(-6);
    const handle = `journey-org-${suffix}`;
    const displayName = `Journey Org ${suffix}`;

    await page.goto('/workspaces/new');
    await expect(page.getByRole('heading', { name: 'New Workspace' })).toBeVisible({ timeout: 15_000 });
    await showCaption(page, 'Fill the new-workspace form');

    await click(page, page.getByLabel('Handle'));
    await page.getByLabel('Handle').fill(handle);
    await page.getByLabel('Display name').fill(displayName);
    await page.getByLabel(/bio/i).fill('Created from the create-workspace journey.');
    await showStep(page);

    await showCaption(page, 'Submitting — POST /api/namespaces');
    await click(page, page.getByRole('button', { name: /create workspace/i }));

    // onSuccess of the mutation redirects to `/${handle}`. The workspace home
    // loads via the same react-query cache the optimistic prepend touched, so
    // the sidebar entry comes "for free".
    await page.waitForURL(new RegExp(`/${handle}(?:/|$)`), { timeout: 25_000 });
    await showCaption(page, 'Landed on new workspace home');

    // The sidebar switcher is driven by `useAllUserNamespaces` (selector over
    // useUserMe). The new workspace must be present immediately, not on
    // next-load refresh.
    await expect(page.getByText(displayName).first()).toBeVisible({ timeout: 10_000 });
    await showResult(page);
    await endRecording(page);
  });
});
