import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * `object`-typed trigger input (ADR-0012). It is the declared escape hatch for an
 * opaque third-party body: the Definition says "a JSON object lands under this
 * key" and nothing about its contents, so the Start Run form renders it as a JSON
 * textarea instead of a generated per-field control.
 *
 * Runs against the dedicated `Object Input Test` fixture (seed-data.ts), whose
 * contract is a single required `webhookBody` of type `object`.
 */

const WORKFLOW = 'Object Input Test';

test.describe('Object Trigger Input Journey', () => {
  test('a JSON body is typed into the object field and starts a run; unparseable text blocks it', async ({
    page,
  }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(WORKFLOW)}`);
    await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /start run/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Run input')).toBeVisible({ timeout: 15_000 });

    // The object field is a JSON textarea, labelled and described from the
    // contract — not a generated set of per-key inputs, because the Definition
    // declares nothing about the body's keys.
    await expect(dialog.getByText('webhookBody')).toBeVisible();
    await expect(dialog.getByText('Opaque upstream payload')).toBeVisible();
    const bodyField = dialog.locator('textarea');
    await expect(bodyField).toBeVisible();

    // Required and empty — nothing to submit yet.
    const startButton = dialog.getByRole('button', { name: /^start (run|anyway)$/i });
    await expect(startButton).toBeDisabled();

    // Text that isn't JSON is rejected in the form, so it never reaches the
    // server as a guaranteed 400.
    await bodyField.fill('{"order": ');
    await expect(dialog.getByText('Must be a JSON object')).toBeVisible();
    await expect(startButton).toBeDisabled();

    // A JSON array parses but is not an object: ADR-0012 deliberately has no
    // `array` type, so an opaque array has to nest under an object key.
    await bodyField.fill('["ORD-9"]');
    await expect(dialog.getByText('Must be a JSON object')).toBeVisible();
    await expect(startButton).toBeDisabled();

    // A real third-party body — arbitrarily nested, none of it declared.
    await bodyField.fill('{"order":{"id":"ORD-9","items":[1,2]},"source":"vendor-x"}');
    await expect(dialog.getByText('Must be a JSON object')).toHaveCount(0);
    await expect(startButton).toBeEnabled();

    // Complete the action: the run starts, which is only possible if the server
    // accepted the object payload against the contract.
    await startButton.click();
    await expect(page).toHaveURL(/\/runs\/[^/]+$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: WORKFLOW })).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/In Progress|Waiting for human/).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
