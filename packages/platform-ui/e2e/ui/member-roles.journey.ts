import { test, expect } from '../helpers/test-fixtures';
import { createTestUser } from '../helpers/emulator';
import {
  seedPostgresOrganizationNamespace,
  seedPostgresWorkspaceMember,
} from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * UI journey for process-role assignment from the workspace settings Roles
 * table (#1250).
 *
 * The API half is covered in `e2e/api/namespace-member-roles.journey.ts`. What
 * only a UI journey can prove is that the grant survives a reload: an
 * optimistic patch on the members cache looks identical to a persisted write
 * until the page is re-fetched from Postgres, which is exactly the failure a
 * component test cannot see.
 */
const OWNER_EMAIL = 'member-roles-owner@mediforce.dev';
const OWNER_PASSWORD = 'MemberRoles123!';
const OWNER_DISPLAY_NAME = 'Roles Owner';
const ALICE_EMAIL = 'member-roles-alice@mediforce.dev';
const ALICE_PASSWORD = 'MemberRolesAlice123!';
const ALICE_DISPLAY_NAME = 'Alice Reviewer';
const HANDLE = 'member-roles-labs';

test.describe('Workspace member roles journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const ownerUid = await createTestUser(OWNER_EMAIL, OWNER_PASSWORD, OWNER_DISPLAY_NAME);
    const aliceUid = await createTestUser(ALICE_EMAIL, ALICE_PASSWORD, ALICE_DISPLAY_NAME);

    await seedPostgresOrganizationNamespace(HANDLE, ownerUid, 'Member Roles Labs');
    await seedPostgresWorkspaceMember(HANDLE, aliceUid, 'member', ALICE_DISPLAY_NAME);
  });

  test('owner assigns a role → the row survives a reload', async ({
    page,
  }) => {
    trackPageErrors(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Email').click();
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Wait for the post-login redirect so the auth cookie is established before
    // the settings GET runs — otherwise it 401-bounces back to /login.
    await page.waitForURL(new RegExp(`/(workspace-selection|${HANDLE})`), { timeout: 30_000 });

    await page.goto(`/${HANDLE}/settings`);
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
      timeout: 30_000,
    });

    // The Roles table is its own roster: one row per (member, role), so which
    // workflows belong to which role is the table's structure rather than
    // something the reader has to infer from a shared cell.
    await page.getByRole('button', { name: /assign role/i }).click();
    await page.getByLabel('Member to assign a role to').selectOption({ label: ALICE_DISPLAY_NAME });
    await page.getByLabel('Role to assign').fill('reviewer');
    // The row appears the instant it is clicked — the write is optimistic — so
    // the reload below would otherwise race the PUT and abort it, and the test
    // would fail for a reason that has nothing to do with persistence.
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url().endsWith('/roles'),
    );
    await page.getByRole('button', { name: 'Grant' }).click();
    expect((await saved).status()).toBe(200);

    // Scoped to the Roles table: her name is in the members table too.
    const rolesTable = page.getByRole('table', { name: 'Roles' });
    const aliceRoleRow = rolesTable.getByRole('row').filter({ hasText: ALICE_DISPLAY_NAME });
    await expect(
      aliceRoleRow.getByRole('button', { name: `Remove reviewer from ${ALICE_DISPLAY_NAME}` }),
    ).toBeVisible({ timeout: 15_000 });

    // An untouched scope control grants across the whole workspace — narrowing
    // costs a deliberate extra choice (ADR-0019). This workspace has no
    // workflows to narrow to.
    await expect(aliceRoleRow.getByText('All workflows')).toBeVisible();

    // The reload is the assertion: an optimistic patch that never reached
    // Postgres would render exactly the same row until this point.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page
        .getByRole('table', { name: 'Roles' })
        .getByRole('row')
        .filter({ hasText: ALICE_DISPLAY_NAME })
        .getByRole('button', { name: `Remove reviewer from ${ALICE_DISPLAY_NAME}` }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
