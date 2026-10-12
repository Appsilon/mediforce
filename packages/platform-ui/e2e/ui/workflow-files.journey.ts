import type { Page } from '@playwright/test';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * Authoring the files a workflow carries (L4). The point is that a workflow
 * needing a script or a Dockerfile no longer needs a repository: it is written
 * here, saved with the version, and read from `/artifacts` at run time.
 *
 * Its own fixture, because saving registers versions of it.
 */

const WORKFLOW = 'Files Editor Test';
const EDITOR_URL = `/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(WORKFLOW)}/definitions/1`;
const DEFINITION_API = `/api/workflow-definitions/${encodeURIComponent(WORKFLOW)}`;

async function saveVersion(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('e.g. Added AI review step').fill(title);
  await page.getByRole('button', { name: /save new version/i }).click();
}

/** The version saved under `title`, once the save has landed; null before. */
async function savedVersion(page: Page, title: string): Promise<WorkflowDefinition | null> {
  const list = await page.request.get(`${DEFINITION_API}/versions?namespace=${TEST_ORG_HANDLE}`);
  const { versions } = (await list.json()) as { versions: { version: number; title?: string }[] };
  const match = versions.find((entry) => entry.title === title);
  if (match === undefined) return null;
  const response = await page.request.get(`${DEFINITION_API}?namespace=${TEST_ORG_HANDLE}&version=${String(match.version)}`);
  return ((await response.json()) as { definition: WorkflowDefinition }).definition;
}

test.describe('Workflow Files Journey', () => {
  test('a file written in the editor saves with the version and reopens', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(EDITOR_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();

    // Nothing yet: the empty state says what a file is for.
    await expect(page.getByText(/no files yet/i)).toBeVisible();

    await page.getByRole('button', { name: /add file/i }).click();
    await page.getByLabel('New file path').fill('scripts/poll.py');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The path the container will see is stated, since that is what a step's
    // command has to name.
    await expect(page.getByText('/artifacts/scripts/poll.py')).toBeVisible();

    await page.locator('.cm-content').click();
    await page.keyboard.insertText('print("poll")\n');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeHidden();

    await saveVersion(page, 'with a script');

    // The version carries the file, byte for byte.
    let version = 0;
    await expect(async () => {
      const saved = await savedVersion(page, 'with a script');
      expect(saved?.artifacts).toEqual([{ path: 'scripts/poll.py', contents: 'print("poll")\n' }]);
      version = saved?.version ?? 0;
    }).toPass({ timeout: 20_000 });

    // Reopening that version shows the file, so the round trip is complete.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(WORKFLOW)}/definitions/${String(version)}`);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByLabel('File path')).toHaveValue('scripts/poll.py');
    await expect(page.locator('.cm-content')).toContainText('print("poll")');
  });

  test('files are uploaded from disk, and a binary is refused with the reason', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(EDITOR_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();

    // A script from disk, a nested skill file, and a PNG. The first two are
    // text and land; the third is not and comes back with a reason, without
    // costing the author the other two.
    await page.getByLabel('Files to upload').setInputFiles([
      { name: 'poll.py', mimeType: 'text/x-python', buffer: Buffer.from('print("uploaded")\n') },
      { name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('# Validator\n') },
      { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    ]);

    await expect(page.getByText(/logo\.png was not added: not a text file/i)).toBeVisible();
    await expect(page.getByText(/put binaries in an image or a repository/i)).toBeVisible();

    // Both text files are in the list, and the one that was selected shows its
    // contents rather than an empty editor.
    // Exact: each row also has a "Remove <path>" button beside it.
    await expect(page.getByRole('button', { name: 'poll.py', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SKILL.md', exact: true })).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('print("uploaded")');

    // And they register as the workflow's files.
    await page.keyboard.press('Escape');
    await saveVersion(page, 'uploaded files');

    await expect(async () => {
      expect((await savedVersion(page, 'uploaded files'))?.artifacts).toEqual([
        { path: 'poll.py', contents: 'print("uploaded")\n' },
        { path: 'SKILL.md', contents: '# Validator\n' },
      ]);
    }).toPass({ timeout: 20_000 });
  });

  test('a path that cannot be written is refused before the save', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(EDITOR_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: /add file/i }).click();
    await page.getByLabel('New file path').fill('../escape.py');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The same rule the server applies, run on the draft: the author is told
    // here rather than losing a save to a 400.
    await expect(page.getByText(/artifact path must not contain/i)).toBeVisible();
  });

  test('an agent step adds a catalog skill, and the version saves it', async ({ page }) => {
    trackPageErrors(page);
    const skillId = `e2e-step-skill-${Date.now()}`;
    const skillRes = await page.request.post(`/api/skills?namespace=${TEST_ORG_HANDLE}`, {
      data: { files: [{ path: 'SKILL.md', contents: `---\nname: ${skillId}\ndescription: Validate SDTM domains\n---\n` }] },
    });
    expect(skillRes.status(), await skillRes.text()).toBe(201);

    try {
      await page.goto(EDITOR_URL);
      await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });
      await page.locator('.react-flow__node', { hasText: 'Interpret' }).first().click();
      await page.getByText('Prompt & model').click();

      // The step adds to its agent; the picker lists the workspace's catalog.
      await expect(page.getByText(/replaces it\./)).toBeVisible();
      await page.getByLabel('Add skill').selectOption(`${TEST_ORG_HANDLE}/${skillId}`);
      await expect(page.getByRole('button', { name: `Remove skill ${TEST_ORG_HANDLE}/${skillId}` })).toBeVisible();

      await saveVersion(page, 'with a step skill');

      await expect(async () => {
        const saved = await savedVersion(page, 'with a step skill');
        expect(saved?.steps.find((step) => step.id === 'interpret')?.agent?.skills).toEqual([{ namespace: TEST_ORG_HANDLE, id: skillId }]);
      }).toPass({ timeout: 20_000 });
    } finally {
      await page.request.delete(`/api/skills/${skillId}?namespace=${TEST_ORG_HANDLE}`);
    }
  });
});
