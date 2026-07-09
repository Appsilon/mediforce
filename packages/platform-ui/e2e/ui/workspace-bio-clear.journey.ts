import { test, expect } from '../helpers/test-fixtures';
import { createTestUser } from '../helpers/emulator';
import {
  readPostgresWorkspace,
  seedPostgresOrganizationNamespace,
} from '../helpers/postgres-seed';
import { trackPageErrors } from '../helpers/page-errors';

const OWNER_EMAIL = 'bio-clear-owner@mediforce.dev';
const OWNER_PASSWORD = 'BioClear123!';
const OWNER_DISPLAY_NAME = 'Bio Clear Owner';
const HANDLE = 'bio-clear-labs';
const INITIAL_BIO = 'initial bio text';

test.describe('Workspace bio clear journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const uid = await createTestUser(OWNER_EMAIL, OWNER_PASSWORD, OWNER_DISPLAY_NAME);

    // Org workspace the owner manages, pre-populated with a non-empty bio so
    // the test has something to clear. Membership (owner) derives from
    // `workspace_members`; the legacy `users/{uid}.organizations` array is gone.
    await seedPostgresOrganizationNamespace(HANDLE, uid, 'Bio Clear Labs', { bio: INITIAL_BIO });
  });

  test('owner clears bio → bio stored as empty string', async ({
    page,
  }) => {
    trackPageErrors(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });
    await page.getByLabel('Email').click();
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Wait for the post-login redirect so auth context is fully established
    // before we navigate into the app — otherwise the settings GET races the
    // auth cookie and 401-bounces to /login.
    await page.waitForURL(/\/(workspace-selection|bio-clear-labs)/, { timeout: 30_000 });

    await page.goto(`/${HANDLE}/settings`);
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
      timeout: 30_000,
    });

    const bioField = page.getByLabel('Description');
    await expect(bioField).toHaveValue(INITIAL_BIO);

    await bioField.fill('');

    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Two-state bio semantics: undefined leaves the field untouched; any
    // string overwrites it. Clearing the description in the UI sends
    // `bio: ""` and the persisted `workspaces` row stores an empty string
    // (not NULL). The original PR4.5 bug — UI dropped `undefined`, so "clear"
    // never reached the backend — is moot now that the UI always sends a string.
    const row = await readPostgresWorkspace(HANDLE);
    expect(row).not.toBeNull();
    expect(row?.displayName).toBeTruthy();
    expect(row?.handle).toBe(HANDLE);
    expect(row?.bio).toBe('');
  });
});
