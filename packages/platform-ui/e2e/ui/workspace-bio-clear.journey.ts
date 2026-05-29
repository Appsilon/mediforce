import { test, expect } from '../helpers/test-fixtures';
import {
  createTestUser,
  getDocumentFields,
  seedCollection,
  seedSubcollection,
} from '../helpers/emulator';
import {
  setupRecording,
  click,
  showStep,
  showResult,
  showCaption,
  endRecording,
} from '../helpers/recording';

const OWNER_EMAIL = 'bio-clear-owner@mediforce.dev';
const OWNER_PASSWORD = 'BioClear123!';
const OWNER_DISPLAY_NAME = 'Bio Clear Owner';
const HANDLE = 'bio-clear-labs';
const INITIAL_BIO = 'initial bio text';

test.describe('Workspace bio clear journey', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    const uid = await createTestUser(OWNER_EMAIL, OWNER_PASSWORD, OWNER_DISPLAY_NAME);

    await seedCollection('users', {
      [uid]: {
        uid,
        email: OWNER_EMAIL,
        displayName: OWNER_DISPLAY_NAME,
        handle: `${HANDLE}-personal`,
        organizations: [HANDLE],
      },
    });
    await seedCollection('namespaces', {
      [HANDLE]: {
        handle: HANDLE,
        type: 'organization',
        displayName: 'Bio Clear Labs',
        bio: INITIAL_BIO,
        createdAt: new Date().toISOString(),
      },
    });
    await seedSubcollection('namespaces', HANDLE, 'members', {
      [uid]: { uid, role: 'owner', joinedAt: new Date().toISOString() },
    });
  });

  test('owner clears bio → bio stored as empty string in Firestore', async ({
    page,
  }, testInfo) => {
    await setupRecording(page, 'workspace-bio-clear', testInfo);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mediforce' })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Owner signs in to clear the workspace bio');
    await click(page, page.getByLabel('Email'));
    await page.getByLabel('Email').fill(OWNER_EMAIL);
    await page.getByLabel('Password').fill(OWNER_PASSWORD);
    await showStep(page);
    await click(page, page.getByRole('button', { name: /^sign in$/i }));

    // Wait for the post-login redirect so auth context is fully established
    // before we navigate into the app — otherwise the settings GET races the
    // auth cookie and 401-bounces to /login.
    await page.waitForURL(/\/(workspace-selection|bio-clear-labs)/, { timeout: 30_000 });

    await page.goto(`/${HANDLE}/settings`);
    await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible({
      timeout: 30_000,
    });
    await showCaption(page, 'Owner edits workspace bio');

    const bioField = page.getByLabel('Description');
    await expect(bioField).toHaveValue(INITIAL_BIO);
    await showStep(page);

    await bioField.fill('');
    await showStep(page);

    await showCaption(page, 'Saving with empty description…');
    await click(page, page.getByRole('button', { name: /save changes/i }));
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Bio cleared — verifying Firestore doc');

    // Two-state bio semantics: undefined leaves the field untouched; any
    // string overwrites it. Clearing the description in the UI sends
    // `bio: ""` and the Firestore doc round-trips as an empty stringValue.
    // The original PR4.5 bug — UI dropped `undefined`, so "clear" never
    // reached Firestore — is moot now that the UI always sends a string.
    const fields = await getDocumentFields('namespaces', HANDLE);
    expect(fields).not.toBeNull();
    expect(fields).toHaveProperty('displayName');
    expect(fields).toHaveProperty('handle');
    expect((fields?.bio as { stringValue?: string } | undefined)?.stringValue).toBe('');

    await showResult(page);
    await endRecording(page);
  });
});
