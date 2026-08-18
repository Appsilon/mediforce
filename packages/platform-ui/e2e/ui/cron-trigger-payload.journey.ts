import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { allowPageErrors, trackPageErrors } from '../helpers/page-errors';

/**
 * Cron static payload editor (ADR-0012). A cron tick has no caller, so the input
 * it hands the Run is authored on the trigger row itself — which is what lets two
 * schedules on one workflow fire different constants. The payload is validated at
 * attach time against the workflow's `triggerInput`, so a write that violates the
 * contract never lands.
 *
 * Runs against the dedicated `Cron Payload Test` fixture (seed-data.ts), whose
 * contract is `studyId: string (required, no default)` + `priority: select
 * (default normal)`. Only this journey attaches triggers to it.
 */

const WORKFLOW = 'Cron Payload Test';
const WORKFLOW_PATH = `/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(WORKFLOW)}`;

/**
 * The payload box's placeholder is *derived* from `triggerInput` rather than a
 * guessed sample (ADR-0012), so matching on it both locates the textarea and
 * asserts the derivation: `string` → `<name>`, `select` → its first option.
 */
const DERIVED_PAYLOAD_PLACEHOLDER = '{"studyId":"<studyId>","priority":"low"}';

const CONTRACT_HELPER_TEXT =
  "JSON object matching this workflow's triggerInput: studyId: string (required), priority: select.";

async function openTriggersTab(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(WORKFLOW_PATH);
  await expect(page.getByRole('tab', { name: /runs/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Triggers' }).click();
  await expect(page.getByRole('heading', { name: 'Manual' })).toBeVisible({ timeout: 15_000 });
}

/** Remove a cron row if a previous attempt left it behind. Playwright retries
 *  reuse the same seeded database, so a mutating journey has to reset at the
 *  start rather than trust its own cleanup (docs/testing/e2e-strategy.md). */
async function deleteCronRowIfPresent(
  page: import('@playwright/test').Page,
  triggerName: string,
): Promise<void> {
  const row = page.locator('li', { hasText: triggerName });
  if ((await row.count()) === 0) return;
  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });
}

test.describe('Cron Trigger Payload Journey', () => {
  test('two schedules on one workflow carry different static payloads, and a payload is editable per row', async ({
    page,
  }) => {
    trackPageErrors(page);

    const nightly = 'e2e-payload-nightly';
    const weekly = 'e2e-payload-weekly';

    await openTriggersTab(page);
    await deleteCronRowIfPresent(page, nightly);
    await deleteCronRowIfPresent(page, weekly);
    await expect(page.getByText(/no cron triggers yet/i)).toBeVisible({ timeout: 15_000 });

    // The editor names the contract every cron row on this workflow is checked
    // against, so the author knows what to type before they type it.
    await expect(page.getByText(CONTRACT_HELPER_TEXT)).toBeVisible({ timeout: 15_000 });
    const newRowPayload = page.getByPlaceholder(DERIVED_PAYLOAD_PLACEHOLDER);
    await expect(newRowPayload).toBeVisible();

    // First schedule: nightly, firing STUDY-A.
    await page.getByPlaceholder('nightly-refresh').fill(nightly);
    await page.getByPlaceholder('0 6 * * *').fill('0 3 * * *');
    await newRowPayload.fill('{"studyId":"STUDY-A"}');
    await page.getByRole('button', { name: 'Add cron trigger' }).click();

    const nightlyRow = page.locator('li', { hasText: nightly });
    await expect(nightlyRow).toBeVisible({ timeout: 15_000 });
    await expect(nightlyRow.getByText('{"studyId":"STUDY-A"}')).toBeVisible();

    // Second schedule on the SAME workflow, firing a different payload — the
    // point of putting the payload on the row instead of the definition.
    await page.getByPlaceholder('nightly-refresh').fill(weekly);
    await page.getByPlaceholder('0 6 * * *').fill('30 4 * * 1');
    await newRowPayload.fill('{"studyId":"STUDY-B","priority":"high"}');
    await page.getByRole('button', { name: 'Add cron trigger' }).click();

    const weeklyRow = page.locator('li', { hasText: weekly });
    await expect(weeklyRow).toBeVisible({ timeout: 15_000 });
    await expect(weeklyRow.getByText('{"studyId":"STUDY-B","priority":"high"}')).toBeVisible();
    // The first row is untouched — the two payloads are independent.
    await expect(nightlyRow.getByText('{"studyId":"STUDY-A"}')).toBeVisible();

    try {
      // Edit the nightly row's payload in place; the row's own editor opens
      // pre-filled with what is stored.
      await nightlyRow.getByRole('button', { name: 'Edit schedule and payload' }).click();
      const nightlyPayloadEditor = nightlyRow.locator('textarea');
      await expect(nightlyPayloadEditor).toHaveValue(/"studyId": "STUDY-A"/);
      await nightlyPayloadEditor.fill('{"studyId":"STUDY-A2","priority":"low"}');
      await nightlyRow.getByRole('button', { name: 'Save schedule and payload' }).click();

      await expect(nightlyRow.getByText('{"studyId":"STUDY-A2","priority":"low"}')).toBeVisible({
        timeout: 15_000,
      });
      // Still the other row's payload, unchanged by the edit next to it.
      await expect(weeklyRow.getByText('{"studyId":"STUDY-B","priority":"high"}')).toBeVisible();
    } finally {
      await deleteCronRowIfPresent(page, nightly);
      await deleteCronRowIfPresent(page, weekly);
    }
  });

  test('malformed JSON blocks the write, and a payload that violates the contract is rejected', async ({
    page,
  }) => {
    trackPageErrors(page);
    // Each refused write below is the point of this test, and the browser logs
    // every one to the console as a failed request. Only that exact message is
    // expected — a React violation or any other console error still fails the
    // test, and so does a rejection arriving as any status other than 400.
    allowPageErrors(page, [
      /^Failed to load resource: the server responded with a status of 400 \(Bad Request\)/,
    ]);

    // This journey never completes a write, so it owns no row. The name only has
    // to be distinct from the happy path's rows.
    const rejected = 'e2e-payload-rejected';

    await openTriggersTab(page);
    await expect(page.getByText(CONTRACT_HELPER_TEXT)).toBeVisible({ timeout: 15_000 });

    const payloadBox = page.getByPlaceholder(DERIVED_PAYLOAD_PLACEHOLDER);
    const addButton = page.getByRole('button', { name: 'Add cron trigger' });

    await page.getByPlaceholder('nightly-refresh').fill(rejected);
    await page.getByPlaceholder('0 6 * * *').fill('0 5 * * *');

    // 1. Text that isn't JSON never reaches the server — the button is dead.
    await payloadBox.fill('{"studyId": ');
    await expect(page.getByText('Not valid JSON.')).toBeVisible();
    await expect(addButton).toBeDisabled();

    // A JSON array is well-formed but is not a payload: the body's top-level keys
    // are the declared fields, so an array has nothing to map.
    await payloadBox.fill('["STUDY-A"]');
    await expect(page.getByText('Not valid JSON.')).toBeVisible();
    await expect(addButton).toBeDisabled();

    // 2. No payload at all on a workflow whose contract has a required field with
    // no default: the write is refused, and the message says what to do about it.
    await payloadBox.fill('');
    await expect(page.getByText('Not valid JSON.')).toHaveCount(0);
    await expect(addButton).toBeEnabled();
    await addButton.click();
    await expect(page.getByText(/required field 'studyId' is missing/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/a cron trigger on a workflow that requires input must carry a payload/),
    ).toBeVisible();

    // 3. A payload carrying a field the contract never declared is rejected with
    // that field named — undeclared keys are a hard error, not silently dropped.
    await payloadBox.fill('{"studyId":"STUDY-A","bogus":true}');
    await addButton.click();
    await expect(
      page.getByText(/unknown field 'bogus' not declared in triggerInput/),
    ).toBeVisible({ timeout: 15_000 });

    // 4. A declared field of the wrong type is rejected the same way.
    await payloadBox.fill('{"studyId":"STUDY-A","priority":"urgent"}');
    await addButton.click();
    await expect(
      page.getByText(/'priority' must be one of: low, normal, high/),
    ).toBeVisible({ timeout: 15_000 });

    // Nothing was written: no row exists under that name.
    await expect(page.locator('li', { hasText: rejected })).toHaveCount(0);
  });
});
