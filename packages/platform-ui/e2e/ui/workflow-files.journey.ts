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

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('e.g. Added AI review step').fill('with a script');
    await page.getByRole('button', { name: /save new version/i }).click();

    // The version carries the file, byte for byte.
    let savedVersion = 0;
    await expect(async () => {
      const saved = await page.evaluate(async (workflow) => {
        const base = `/api/workflow-definitions/${encodeURIComponent(workflow)}`;
        const list = await fetch(`${base}/versions?namespace=test`);
        const { versions } = (await list.json()) as { versions: { version: number; title?: string }[] };
        const match = versions.find((entry) => entry.title === 'with a script');
        if (match === undefined) return null;
        const response = await fetch(`${base}?namespace=test&version=${String(match.version)}`);
        const body = (await response.json()) as {
          definition: { artifacts?: { path: string; contents: string }[] };
        };
        return { version: match.version, artifacts: body.definition.artifacts };
      }, WORKFLOW);
      expect(saved?.artifacts).toEqual([{ path: 'scripts/poll.py', contents: 'print("poll")\n' }]);
      savedVersion = saved?.version ?? 0;
    }).toPass({ timeout: 20_000 });

    // Reopening that version shows the file, so the round trip is complete.
    await page.goto(`/${TEST_ORG_HANDLE}/workflows/${encodeURIComponent(WORKFLOW)}/definitions/${String(savedVersion)}`);
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
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: /name this version/i })).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder('e.g. Added AI review step').fill('uploaded files');
    await page.getByRole('button', { name: /save new version/i }).click();

    await expect(async () => {
      const saved = await page.evaluate(async (workflow) => {
        const base = `/api/workflow-definitions/${encodeURIComponent(workflow)}`;
        const list = await fetch(`${base}/versions?namespace=test`);
        const { versions } = (await list.json()) as { versions: { version: number; title?: string }[] };
        const match = versions.find((entry) => entry.title === 'uploaded files');
        if (match === undefined) return null;
        const response = await fetch(`${base}?namespace=test&version=${String(match.version)}`);
        const body = (await response.json()) as {
          definition: { artifacts?: { path: string; contents: string }[] };
        };
        return body.definition.artifacts;
      }, WORKFLOW);
      expect(saved).toEqual([
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

  test('an uploaded skills folder is offered where an agent step picks its skill', async ({ page }) => {
    trackPageErrors(page);
    await page.goto(EDITOR_URL);
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByLabel('Files to upload').setInputFiles([
      { name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from('# Data validator\n') },
    ]);
    // Uploaded flat, then given the path a skill needs: `<dir>/<skill>/SKILL.md`
    // is what the runtime reads, and the picker below is what proves it.
    await page.getByLabel('File path').fill('skills/data-validator/SKILL.md');
    await page.keyboard.press('Escape');

    await page.locator('.react-flow__node', { hasText: 'Interpret' }).first().click();
    await page.getByText('Prompt & model').click();

    const picker = page.getByLabel('Skill', { exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveText(['None', 'data-validator']);

    // Picking it fills in both fields the runtime needs, which is what typing a
    // repo path by hand used to be for.
    await picker.selectOption('skills/data-validator');
    await expect(page.getByLabel('Skills directory')).toHaveValue('skills');
  });
});
