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
});
