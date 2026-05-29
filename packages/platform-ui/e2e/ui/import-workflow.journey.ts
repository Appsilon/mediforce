import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { setupRecording, click, showStep, showResult, endRecording } from '../helpers/recording';

const MOCK_MANIFEST = {
  workflows: [
    {
      name: 'Workflow Designer',
      path: 'workflow-designer/workflow-designer.wd.json',
      description: 'Meta-workflow that designs Mediforce WorkflowDefinitions.',
      tags: ['meta', 'designer'],
      builtin: true,
    },
    {
      name: 'Community Digest',
      path: 'community-digest/community-digest.wd.json',
      description: 'Daily GitHub scan → rank changes → draft Discord posts.',
      tags: ['meta', 'community'],
    },
  ],
};

test.describe('Import Workflow from Git Journey', () => {
  test('opens import dialog, browses a GitHub repo, selects a workflow, and imports it', async ({ page }, testInfo) => {
    await setupRecording(page, 'import-workflow-from-git', testInfo);

    // Intercept the client-side manifest fetch so the test doesn't need GitHub to be reachable.
    await page.route(
      (url) => url.hostname === 'raw.githubusercontent.com',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_MANIFEST),
        });
      },
    );

    // Intercept the server-side import call — the route handler would otherwise reach GitHub.
    await page.route(
      (url) => url.pathname === '/api/workflow-definitions/import',
      async (route) => {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ name: 'workflow-designer', version: 1, namespace: TEST_ORG_HANDLE }),
        });
      },
    );

    // Navigate to the workspace page
    await page.goto(`/${TEST_ORG_HANDLE}`);
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({ timeout: 10_000 });
    await showStep(page);

    // Open the dialog via the "Import from git" toolbar button
    await click(page, page.getByRole('button', { name: /import from git/i }).first());
    await expect(page.getByText('Import workflows from git')).toBeVisible({ timeout: 3_000 });

    // Default repo URL is pre-filled with the mediforce-workflows public repo
    await expect(page.getByLabel('Repository URL')).toHaveValue('https://github.com/Appsilon/mediforce-workflows');
    await showStep(page);

    // Click Browse — triggers the mocked manifest fetch
    await click(page, page.getByRole('button', { name: /browse/i }));

    // Workflow list appears with entries from the mock manifest
    await expect(page.getByText('Workflow Designer')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Community Digest')).toBeVisible();
    await expect(page.getByText(/2 workflows found/)).toBeVisible();
    await showStep(page);

    // Select "Workflow Designer" via its label
    await click(page, page.getByText('Workflow Designer').first());
    await expect(page.getByRole('button', { name: /import 1 workflow/i })).toBeEnabled();
    await showStep(page);

    // Confirm import — triggers the mocked API call
    await click(page, page.getByRole('button', { name: /import 1 workflow/i }));

    // Success state
    await expect(page.getByText(/imported 1 of 1 workflow/i)).toBeVisible({ timeout: 10_000 });
    await showResult(page);

    // Close dialog
    await click(page, page.getByRole('button', { name: /done/i }));
    await expect(page.getByText('Import workflows from git')).not.toBeVisible();

    await endRecording(page);
  });
});
