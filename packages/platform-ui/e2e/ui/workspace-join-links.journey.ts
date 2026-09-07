import { test, expect } from '../helpers/test-fixtures';
import { createTestUser, deleteAuthUser } from '../helpers/emulator';
import {
  clearPostgresJoinLinks,
  clearPostgresWorkspaceMemberByEmail,
  seedPostgresOrganizationNamespace,
} from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * UI journey for workspace join links (ADR-0021), end to end across the two
 * surfaces the feature ships: an admin minting a link in workspace settings,
 * and a stranger redeeming it at `/join/<token>`.
 *
 * The API half is covered in `e2e/api/workspace-join-links.journey.ts`. What
 * only a UI journey can prove is the handover between the two, which is where
 * this feature's whole value sits: the plaintext URL is shown exactly once, in
 * a field an admin copies out of, and the token in it has to still open the
 * page for somebody who has never signed in. A passing API journey says the
 * handler mints and redeems; it cannot say the admin was ever shown a usable
 * link, or that a signed-out browser can act on it.
 *
 * The redemption runs in its own browser context on purpose — the joiner is
 * unauthenticated, and reusing the admin's context would silently test a
 * signed-in page that no real joiner ever sees.
 */
const OWNER_EMAIL = 'join-links-owner@mediforce.dev';
const OWNER_PASSWORD = 'JoinLinks123!';
const OWNER_DISPLAY_NAME = 'Join Links Owner';
const JOINER_EMAIL = 'join-links-joiner@mediforce.dev';
const JOINER_DISPLAY_NAME = 'Jane Attendee';
const HANDLE = 'join-links-labs';
const WORKSPACE_NAME = 'Join Links Labs';

test.describe('Workspace join links journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const ownerUid = await createTestUser(OWNER_EMAIL, OWNER_PASSWORD, OWNER_DISPLAY_NAME);
    await seedPostgresOrganizationNamespace(HANDLE, ownerUid, WORKSPACE_NAME);

    // This journey mints, spends and revokes a link, so it leaves three rows
    // behind that the NEXT run would read as its own starting state — the
    // empty-state assertion below is the one that catches it. Everything this
    // test creates is therefore cleared up front rather than after: a run that
    // dies mid-journey must not poison the next one.
    await clearPostgresJoinLinks(HANDLE);

    // Redeeming seeds an `auth_users` row for the joiner and a membership row.
    // Left in place, the next run asserts the "already a member" path rather
    // than the first-join one this is written for. Both are scoped to this
    // fixture — never the shared auth-setup state.
    // Membership first: it is resolved through the `auth_users` row that the
    // next line deletes.
    await clearPostgresWorkspaceMemberByEmail(HANDLE, JOINER_EMAIL);
    await deleteAuthUser(JOINER_EMAIL);
  });

  test('admin mints a link → a signed-out joiner redeems it → revoking closes it', async ({
    page,
    browser,
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

    await expect(page.getByText('No join links yet.')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Create join link' }).click();
    await page.getByLabel('Expires in (days)').fill('7');
    await page.getByLabel(/max uses/i).fill('5');
    await page.getByRole('button', { name: 'Create link' }).click();

    // The one moment the plaintext URL exists anywhere outside the minting
    // response — only its SHA-256 is stored, so if this field is empty the
    // link is already unrecoverable and no amount of API coverage would say so.
    await expect(page.getByText('Join link created — copy it now')).toBeVisible({
      timeout: 30_000,
    });
    const mintedUrl = await page.getByLabel('Join link URL').inputValue();
    expect(mintedUrl).toContain('/join/');

    // Navigate by path rather than by the absolute URL: it is built from the
    // deployment's configured base URL, which is not necessarily the origin
    // Playwright serves. The token is the part under test.
    const token = mintedUrl.split('/join/')[1];
    expect(token).toBeTruthy();

    const joinLinks = page.getByRole('table', { name: 'Join links' });
    const row = joinLinks.getByRole('row').filter({ hasText: 'Active' });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('0 / 5');

    // A joiner has no session. A fresh context is what makes that true — the
    // page must resolve the workspace name from the token alone.
    const joinerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const joinerPage = await joinerContext.newPage();
    trackPageErrors(joinerPage);

    try {
      await joinerPage.goto(`/join/${token}`);
      await expect(
        joinerPage.getByRole('heading', { name: `Join ${WORKSPACE_NAME}` }),
      ).toBeVisible({ timeout: 30_000 });

      await joinerPage.getByLabel(/^email/i).fill(JOINER_EMAIL);
      await joinerPage.getByLabel('Name').fill(JOINER_DISPLAY_NAME);
      await joinerPage.getByRole('button', { name: 'Join workspace' }).click();

      // Redeeming seeds the account and mails a sign-in link; it never opens a
      // session (ADR-0021 §4). Landing anywhere inside the workspace here would
      // mean the token had become a credential.
      await expect(joinerPage.getByRole('heading', { name: 'Check your email' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(joinerPage).toHaveURL(new RegExp(`/join/${token}$`));

      // The admin's view of the same redemption. A reload, not an optimistic
      // refresh: the seat is only really spent if Postgres says so.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
        timeout: 30_000,
      });
      const usedRow = page
        .getByRole('table', { name: 'Join links' })
        .getByRole('row')
        .filter({ hasText: 'Active' });
      await expect(usedRow).toContainText('1 / 5', { timeout: 30_000 });

      // The joiner is now a member, which is what the link was for. Asserted on
      // the address rather than the name: the members table renders `email`
      // directly, while the name goes through the seeded profile.
      await expect(page.getByText(JOINER_EMAIL).first()).toBeVisible({ timeout: 15_000 });

      await usedRow.getByRole('button', { name: /^Revoke join link / }).click();
      await expect(
        page.getByRole('table', { name: 'Join links' }).getByRole('row').filter({ hasText: 'Revoked' }),
      ).toBeVisible({ timeout: 30_000 });

      // Revocation has to reach the holder, not just the admin's table — a link
      // that still opens after being closed is the failure this whole surface
      // exists to prevent.
      await joinerPage.goto(`/join/${token}`);
      await expect(
        joinerPage.getByRole('heading', { name: 'This join link was revoked' }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await joinerContext.close();
    }
  });
});
