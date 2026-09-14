import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * The input contract editor on the Triggers tab (ADR-0012). It lives where the
 * contract is explained: every trigger on the tab is validated against it, the
 * cron payload editor labels itself from it, and the webhook example body is
 * generated from it.
 *
 * Saving registers a new version, so this journey owns `Trigger Input Editing`
 * outright. It starts with no input, which covers the empty state and the first
 * save in one pass.
 */

const WORKFLOW = 'Trigger Input Editing';
const WORKFLOW_PATH = `/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(WORKFLOW)}`;

async function openTriggersTab(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(WORKFLOW_PATH);
  await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await expect(page.getByRole('heading', { name: 'Input', exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Trigger Input Editor Journey', () => {
  test('input added on the Triggers tab registers a version and drives the trigger forms', async ({
    page,
  }) => {
    trackPageErrors(page);

    await openTriggersTab(page);

    // Whatever earlier attempts left behind, the tab is the place the contract
    // is read: strip it back to empty so the first save is the first save.
    const removeFirst = page.getByRole('button', { name: 'Remove input 1' });
    while ((await removeFirst.count()) > 0) {
      await removeFirst.click();
    }
    const saveInput = page.getByRole('button', { name: /save input/i });
    if (await saveInput.isEnabled()) {
      await saveInput.click();
      await expect(page.getByText(/saved as version/i)).toBeVisible({ timeout: 20_000 });
    }

    // ── Add a field ───────────────────────────────────────────────────────
    await page.getByRole('button', { name: /add input/i }).click();
    await page.getByLabel('Input 1 name').fill('studyId');
    await page.getByLabel('Input 1 required').check();
    await page.getByLabel('Input 1 description').fill('Study identifier');

    // A choice list with nothing to choose from is the form's own rule, not the
    // schema's, so it blocks the save with a reason rather than a 400.
    await page.getByRole('button', { name: /add input/i }).click();
    await page.getByLabel('Input 2 name').fill('priority');
    await page.getByLabel('Input 2 type').selectOption('select');
    await expect(page.getByText(/priority is a choice list, so it needs at least one option/i))
      .toBeVisible();
    await expect(saveInput).toBeDisabled();
    await page.getByLabel('Input 2 options').fill('low, normal');
    await expect(saveInput).toBeEnabled();

    await saveInput.click();
    await expect(page.getByText(/saved as version/i)).toBeVisible({ timeout: 20_000 });

    // ── The rest of the tab reads the contract that was just saved ────────
    // The cron payload helper names the fields, and the webhook example body is
    // generated from them: proof the save reached the version a firing resolves
    // rather than a version nothing runs.
    await expect(
      page.getByText(
        "JSON object matching this workflow's triggerInput: studyId: string (required), priority: select.",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByPlaceholder('{"studyId":"<studyId>","priority":"low"}')).toBeVisible();

    // ── And the version itself carries it ─────────────────────────────────
    await expect(async () => {
      const { definition: saved } = await page.evaluate(async () => {
        const response = await fetch(
          '/api/workflow-definitions/Trigger%20Input%20Editing?namespace=test',
        );
        return (await response.json()) as {
          definition: {
            triggerInput?: { name: string; type: string; required?: boolean; description?: string }[];
            steps?: { id: string }[];
          };
        };
      });
      expect(saved.triggerInput?.map((field) => field.name)).toEqual(['studyId', 'priority']);
      expect(saved.triggerInput?.[0]?.required).toBe(true);
      expect(saved.triggerInput?.[0]?.description).toBe('Study identifier');
      // The save cuts a version from the whole definition, so the graph it did
      // not touch has to survive: registering only the contract would strand a
      // workflow with no steps.
      expect(saved.steps?.map((step) => step.id)).toEqual(['process', 'done']);
    }).toPass({ timeout: 20_000 });

    // ── Reload: the editor shows what the version carries ─────────────────
    await openTriggersTab(page);
    await expect(page.getByLabel('Input 1 name')).toHaveValue('studyId');
    await expect(page.getByLabel('Input 2 options')).toHaveValue('low, normal');
    await expect(page.getByRole('button', { name: /save input/i })).toBeDisabled();
  });
});
