import { test, expect } from '../helpers/test-fixtures';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Issue #517 — a workspace with no workflows offers "Import example workflows"
 * next to "New workflow", and the box disappears once the namespace holds one.
 *
 * The dialog browses `workflows-index.json` and imports through
 * `POST /api/workflow-definitions/import`, so the run necessarily reaches
 * github.com — there is no local stand-in for resolving a ref to an immutable
 * commit. The probe below self-skips with a diagnostic when GitHub is
 * unreachable or rate limited, the same gate `workflow-import.journey` uses.
 */

const GITHUB_API_PROBE = 'https://api.github.com/repos/Appsilon/mediforce/commits/main';
const MANIFEST_PROBE =
  'https://raw.githubusercontent.com/Appsilon/mediforce/main/workflows-index.json';

let githubAvailable = false;

async function isAvailable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

test.beforeAll(async () => {
  const [api, raw] = await Promise.all([
    isAvailable(GITHUB_API_PROBE),
    isAvailable(MANIFEST_PROBE),
  ]);
  githubAvailable = api && raw;
});

test.describe('Import example workflows journey', () => {
  test('an empty workspace imports an example and loses the empty-state boxes', async ({ page }) => {
    test.skip(!githubAvailable, 'github.com unreachable or rate limited — import cannot resolve.');
    test.setTimeout(90_000);
    trackPageErrors(page);

    const suffix = Date.now().toString().slice(-6);
    const handle = `journey-examples-${suffix}`;

    await page.goto('/workspaces/new');
    await expect(page.getByRole('heading', { name: 'New Workspace' })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Handle').click();
    await page.getByLabel('Handle').fill(handle);
    await page.getByLabel('Display name').fill(`Journey Examples ${suffix}`);
    await page.getByRole('button', { name: /create workspace/i }).click();
    await page.waitForURL(new RegExp(`/${handle}(?:/|$)`), { timeout: 25_000 });

    const examplesBox = page.getByRole('button', { name: /import example workflows/i });
    await expect(examplesBox).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /new workflow/i }).last()).toBeVisible();

    // The box browses the Mediforce examples directly — no repository to fill in.
    await examplesBox.click();
    await expect(page.getByRole('dialog').getByText('Import example workflows')).toBeVisible();
    await expect(page.getByLabel('Repository URL')).toHaveCount(0);

    const example = page.getByText('tutorial-linear-pipeline', { exact: true });
    await expect(example).toBeVisible({ timeout: 30_000 });
    await example.click();
    await page.getByRole('button', { name: 'Import selected' }).click();

    await expect(page.getByText(/imported successfully/)).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Done' }).click();

    // The imported workflow lands in the catalog, which retires the empty state.
    // Cards label a workflow by its display name, not the manifest's id.
    await expect(page.getByText('Tutorial Linear Pipeline').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /import example workflows/i })).toHaveCount(0);
  });
});
