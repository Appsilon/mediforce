import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { createTestUser } from '../helpers/emulator';
import { seedPostgresOrganizationNamespace } from '../helpers/postgres-seed';
import { apiKeyHeaders } from '../helpers/multi-namespace';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * UI journey for the workflow Access tab (#1253).
 *
 * The API half is covered in `e2e/api/workflow-access.journey.ts`. Two things
 * only a browser can prove:
 *
 * - the gate survives a reload — an optimistic cache write renders the same
 *   chips as a persisted one until the page re-fetches from Postgres;
 * - the Start button, Save, Edit and the workflow menu all go grey **with the
 *   reason on them**, rather than staying enabled into a 403. A refused write
 *   surfaces in the editor as a raw API error beside whatever the step
 *   validator was already complaining about, which reads as a broken button
 *   rather than as a permission somebody can go and ask for.
 */
const OWNER_EMAIL = 'workflow-access-owner@mediforce.dev';
const OWNER_PASSWORD = 'WorkflowAccess123!';
const OWNER_DISPLAY_NAME = 'Access Owner';
const HANDLE = 'workflow-access-labs';
const WORKFLOW = 'access-tab-flow';
/** A role this workspace has granted to nobody — including the owner. */
const UNHELD_ROLE = 'access-tab-reviewer';

/** The describe clears storage state, so each test signs in for itself. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });
  await page.getByLabel('Email').click();
  await page.getByLabel('Email').fill(OWNER_EMAIL);
  await page.getByLabel('Password').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(new RegExp(`/(workspace-selection|${HANDLE})`), { timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('Workflow Access tab journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async ({ request }) => {
    const ownerUid = await createTestUser(OWNER_EMAIL, OWNER_PASSWORD, OWNER_DISPLAY_NAME);
    await seedPostgresOrganizationNamespace(HANDLE, ownerUid, 'Workflow Access Labs');

    const existing = await request.get(
      `/api/workflow-definitions/${WORKFLOW}?namespace=${HANDLE}`,
      { headers: apiKeyHeaders() },
    );
    if (existing.status() !== 200) {
      const created = await request.post(`/api/workflow-definitions?namespace=${HANDLE}`, {
        headers: apiKeyHeaders(),
        data: {
          name: WORKFLOW,
          title: 'Access tab flow',
          steps: [
            {
              id: 'act',
              name: 'Act',
              type: 'review',
              executor: 'human',
              verdicts: { approve: { target: 'done' } },
            },
            { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
          ],
          transitions: [{ from: 'act', to: 'done' }],
        },
      });
      expect(created.status(), await created.text()).toBe(201);
    }

    // The gate this test sets survives the run, and the first assertion is
    // about the *unconfigured* state — so start from it rather than depending
    // on a database nobody has run this against before.
    const cleared = await request.put(
      `/api/workflow-definitions/${WORKFLOW}/access?namespace=${HANDLE}`,
      { headers: apiKeyHeaders(), data: { access: { run: [], edit: [] } } },
    );
    expect(cleared.status(), await cleared.text()).toBe(200);
  });

  test('an admin gates Run on a role nobody holds → Start goes grey with the reason', async ({
    page,
  }) => {
    trackPageErrors(page);

    await signIn(page);

    await page.goto(`/${HANDLE}/workflows/${WORKFLOW}?tab=access`);
    await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // An unconfigured workflow says so, rather than showing two empty boxes
    // that could equally mean "nobody may do this".
    await expect(page.getByText('Any member of this workspace can start a run.')).toBeVisible();

    const roleField = page.getByLabel('Add a role that may run this workflow');
    await roleField.fill(UNHELD_ROLE);
    await roleField.press('Enter');

    const saved = page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().includes('/access'),
    );
    await page.getByRole('button', { name: 'Save access' }).click();
    expect((await saved).status()).toBe(200);

    // The gate now names a role with no holder, which closes it to everyone —
    // the one state an admin can create by accident and never see.
    await expect(page.getByText(new RegExp(`Nobody holds "${UNHELD_ROLE}"`))).toBeVisible();

    // The reload is the assertion: a cache write that never reached Postgres
    // renders the identical chip until this point.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: `Remove role ${UNHELD_ROLE}` })).toBeVisible({
      timeout: 30_000,
    });

    // The owner administers the gate but does not hold the role, and there is
    // deliberately no owner/admin override (ADR-0019): an admin who needs to
    // run it grants themselves the role, which leaves an audit trail.
    await page.goto(`/${HANDLE}/workflows/${WORKFLOW}`);
    const startButton = page.getByRole('button', { name: /start run/i }).first();
    await expect(startButton).toHaveAttribute('aria-disabled', 'true', { timeout: 30_000 });
    await startButton.hover();
    await expect(page.getByText(new RegExp(`restricted to '${UNHELD_ROLE}'`))).toBeVisible({
      timeout: 10_000,
    });
  });

  test('a member without the edit role is refused at the controls, not at the server', async ({
    page,
    request,
  }) => {
    trackPageErrors(page);

    // Gate `edit` on a role nobody holds. The signed-in owner administers the
    // gate and is subject to it — ADR-0019 has no owner override on purpose.
    const gated = await request.put(
      `/api/workflow-definitions/${WORKFLOW}/access?namespace=${HANDLE}`,
      { headers: apiKeyHeaders(), data: { access: { run: [], edit: [UNHELD_ROLE] } } },
    );
    expect(gated.status(), await gated.text()).toBe(200);

    await signIn(page);
    await page.goto(`/${HANDLE}/workflows/${WORKFLOW}`);
    await page.getByRole('tab', { name: 'Definitions' }).click();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'aria-disabled',
      'true',
      { timeout: 30_000 },
    );

    // The workflow menu's destructive half is greyed out too — these were open
    // to any member of the workspace before this shipped.
    await page.getByRole('button', { name: 'Workflow actions' }).click();
    for (const action of ['Archive', 'Transfer', 'Delete']) {
      await expect(page.getByRole('button', { name: action, exact: true })).toBeDisabled();
    }
    // Copy is not an edit — it writes a new workflow, and the copy inherits
    // this gate rather than laundering it.
    await expect(page.getByRole('button', { name: 'Copy to...' })).toBeEnabled();
    await page.keyboard.press('Escape');

    // And Save in the editor, where the refusal used to arrive as a raw error.
    await page.goto(`/${HANDLE}/workflows/${WORKFLOW}/definitions/1`);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled({ timeout: 30_000 });
    await save.hover();
    await expect(
      page.getByText(new RegExp(`Changing this workflow is restricted to '${UNHELD_ROLE}'`)),
    ).toBeVisible({ timeout: 10_000 });
  });
});
