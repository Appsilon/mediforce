import { execFileSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

/**
 * L4 UI journey for the Images view (#1297).
 *
 * The question the view exists to answer — "is there already an image like the
 * one I need?" — is answered by facts nothing stores: lineage and versions are
 * recomputed from the daemon on every read. So this journey commits real parent
 * and child images rather than stubbing the API, and asserts what a reader sees:
 * the grouping, the search, the version history, the layer summary (labelled as
 * layer commands, never as a Dockerfile) and the "used by" link.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

/** `alpine` has a shell and none of the probed runtimes, so both images come
 *  out as a known, empty capability set — enough to prove the chips render. */
const BASE_IMAGE = 'alpine:3.22';

function docker(...args: string[]): void {
  execFileSync('docker', args, { stdio: 'pipe' });
}

function dockerAvailable(): boolean {
  try {
    docker('info');
    return true;
  } catch {
    return false;
  }
}

/** `docker commit` rather than `docker build`: one real filesystem layer — what
 *  lineage matches on — in about a second, without occupying BuildKit. */
function deriveImage(tag: string, from: string, command: string): void {
  const container = `mediforce-e2e-ui-${tag.replace(/[^a-z0-9]/gi, '-')}`;
  docker('run', '--name', container, from, ...command.split(' '));
  try {
    docker('commit', container, tag);
  } finally {
    docker('rm', '-f', container);
  }
}

async function catalogue(
  request: APIRequestContext,
  name: string,
  reference: string,
): Promise<string> {
  const res = await request.post(`/api/image-catalog?namespace=${TEST_ORG_HANDLE}`, {
    headers: AUTH,
    data: {
      name,
      intent: 'Exploring ADaM datasets in an isolated sandbox',
      source: { kind: 'referenced', reference },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { entry: { id: string } }).entry.id;
}

test.describe('Image Catalog UI journey', () => {
  test.skip(!dockerAvailable(), 'Docker daemon not available');

  test('an author browses images, searches them and inspects one', async ({ page, request }) => {
    // Every catalog read shells out to Docker, and this journey opens the view,
    // expands an entry and lets it poll. The default 30s is a timing assertion
    // nobody meant to write.
    test.setTimeout(120_000);
    trackPageErrors(page);

    const stamp = Date.now();
    const baseReference = `mediforce-e2e-ui-base-${stamp}`;
    const derivedReference = `mediforce-e2e-ui-derived-${stamp}`;
    const workflowName = `e2e-images-${stamp}`;
    const entryIds: string[] = [];

    try {
      docker('image', 'inspect', BASE_IMAGE);
    } catch {
      docker('pull', BASE_IMAGE);
    }
    // Both images are this journey's own: sharing a tag with another journey
    // would share an image id, and one id cannot belong to two entries.
    deriveImage(`${baseReference}:v1`, BASE_IMAGE, 'mkdir /e2e-base-marker');
    deriveImage(`${derivedReference}:v1`, `${baseReference}:v1`, 'mkdir /e2e-derived-marker');

    try {
      // Catalogued derivative-first, so a grouping that comes out right cannot
      // be insertion order.
      entryIds.push(await catalogue(request, `E2E derived ${stamp}`, derivedReference));
      entryIds.push(await catalogue(request, `E2E base ${stamp}`, baseReference));

      const workflowRes = await request.post(
        `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
        {
          headers: AUTH,
          data: {
            name: workflowName,
            title: `E2E Images ${stamp}`,
            steps: [
              {
                id: 'explore',
                name: 'Explore',
                type: 'creation',
                executor: 'agent',
                autonomyLevel: 'L2',
                agent: { image: `${derivedReference}:v1` },
              },
              { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
            ],
            transitions: [{ from: 'explore', to: 'done' }],
          },
        },
      );
      expect(workflowRes.status(), await workflowRes.text()).toBe(201);

      await page.goto(`/${TEST_ORG_HANDLE}/images`);
      await expect(page.getByRole('heading', { name: 'Images' })).toBeVisible({ timeout: 30_000 });

      // Grouped: the derivative names the entry it was built on.
      const derivedCard = page.getByTestId(`image-entry-${entryIds[0]}`);
      await expect(derivedCard).toBeVisible({ timeout: 30_000 });
      await expect(derivedCard.getByText(`Built on E2E base ${stamp}`)).toBeVisible();
      await expect(page.getByTestId(`image-entry-${entryIds[1]}`)).toBeVisible();

      // Search narrows on the derived entry's name; the base drops out.
      await page.getByLabel('Search images').fill(`E2E derived ${stamp}`);
      await expect(derivedCard).toBeVisible();
      await expect(page.getByTestId(`image-entry-${entryIds[1]}`)).toHaveCount(0);
      await page.getByLabel('Search images').fill('');

      // Expand: version history, and the layer summary named for what it is.
      // The expand toggle, not the card's Edit / Delete actions.
      await derivedCard.getByRole('button', { expanded: false }).click();
      await expect(derivedCard.getByText(`${derivedReference}:v1`)).toBeVisible({
        timeout: 60_000,
      });
      await expect(derivedCard.getByText('current')).toBeVisible();
      await expect(
        derivedCard.getByText(/layer command.*added over .*e2e-ui-base/i),
      ).toBeVisible({ timeout: 60_000 });
      await expect(derivedCard.getByText('mkdir /e2e-derived-marker')).toBeVisible();
      // The base's own layer belongs to the base, not to what was built on it.
      await expect(derivedCard.getByText('mkdir /e2e-base-marker')).toHaveCount(0);

      // Nothing on a `docker commit`ed image names a repo and a commit, so the
      // ladder stops at rung 4 and says so instead of offering a link.
      await expect(derivedCard.getByText('No source recorded')).toBeVisible();

      // "Used by" resolves to the workflow whose step pins this image.
      const usedBy = derivedCard.getByRole('link', { name: `E2E Images ${stamp}` });
      await expect(usedBy).toBeVisible({ timeout: 60_000 });
      await usedBy.click();
      await expect(page).toHaveURL(new RegExp(`/workflows/${workflowName}$`));
    } finally {
      for (const id of entryIds) {
        await request.delete(`/api/image-catalog/${id}?namespace=${TEST_ORG_HANDLE}`, {
          headers: AUTH,
        });
      }
      await request.delete(
        `/api/workflow-definitions/${workflowName}?namespace=${TEST_ORG_HANDLE}`,
        { headers: AUTH },
      );
      docker('rmi', `${derivedReference}:v1`, `${baseReference}:v1`);
    }
  });

  test('an author catalogues a repository, then edits what the entry says', async ({
    page,
    request,
  }) => {
    // One catalog read per navigation, each shelling out to Docker.
    test.setTimeout(120_000);
    trackPageErrors(page);

    const stamp = Date.now();
    // A repo the platform has never built from: the entry it creates has no
    // image behind it, which is the state this flow exists for and the one
    // **Describe** can never reach — that one only ever names a source some
    // build already recorded.
    const repo = `Appsilon/e2e-added-${stamp}`;
    const intent = `Catalogued from the Images view ${stamp}, never built here.`;
    let entryId = '';

    try {
      await page.goto(`/${TEST_ORG_HANDLE}/images`);
      await page.getByRole('button', { name: /Add image/ }).click();

      // Scoped to the dialog and exact: `getByLabel` matches substrings, and
      // the page behind it carries labels of its own.
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Repository', { exact: true }).fill(repo);
      await dialog.getByLabel(/Dockerfile/).fill('container/Dockerfile');
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(`e2e-added-${stamp}`);
      await dialog.getByLabel('Description', { exact: true }).fill(intent);
      await dialog.getByRole('button', { name: 'Add to the catalog' }).click();

      // The dialog closes only once the write resolved, so this is the gate
      // that keeps the assertions below from racing the request.
      await expect(dialog).toBeHidden({ timeout: 60_000 });

      // The row renders from a catalog read, so seeing it means the entry was
      // persisted and read back rather than merely POSTed.
      await expect(page.getByText(intent)).toBeVisible({ timeout: 60_000 });

      const listRes = await request.get(`/api/image-catalog?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH,
      });
      const { entries } = (await listRes.json()) as {
        entries: { id: string; source: { repo?: string }; availability: string }[];
      };
      const added = entries.find((entry) => entry.source.repo?.includes(`e2e-added-${stamp}`));
      expect(added, 'the added entry is not in the catalog').toBeDefined();
      entryId = added?.id ?? '';
      // Stored in one canonical form, so the entry matches images built from
      // it however a step author wrote the reference.
      expect(added?.source.repo).toBe(`git@github.com:${repo}.git`);
      // Nothing built it, and the entry says so rather than hiding.
      expect(added?.availability).toBe('absent');

      // A registered entry is not frozen: the name and the sentence are the
      // fields a human owns, and **Edit** is where they are changed.
      const revisedName = `e2e-renamed-${stamp}`;
      const revisedIntent = `Revised from the Images view ${stamp}.`;
      const card = page.getByTestId(`image-entry-${entryId}`);
      await expect(card).toBeVisible({ timeout: 60_000 });
      await card.getByRole('button', { name: 'Edit' }).click();

      const editDialog = page.getByRole('dialog');
      // Prefilled with what the entry says today rather than blank — an edit
      // form that starts empty is a retype, not an edit.
      await expect(editDialog.getByLabel('Description', { exact: true })).toHaveValue(intent);
      await editDialog.getByLabel('Name', { exact: true }).fill(revisedName);
      await editDialog.getByLabel('Description', { exact: true }).fill(revisedIntent);
      await editDialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(editDialog).toBeHidden({ timeout: 60_000 });

      // Rendered from a catalog read, so seeing it means the patch persisted.
      await expect(page.getByText(revisedIntent)).toBeVisible({ timeout: 60_000 });

      const afterEdit = await request.get(
        `/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
        { headers: AUTH },
      );
      const edited = (await afterEdit.json()) as {
        entry: { id: string; name: string; intent: string; source: { repo?: string } };
      };
      expect(edited.entry.name).toBe(revisedName);
      expect(edited.entry.intent).toBe(revisedIntent);
      // An edit that leaves the source alone leaves the key alone: one entry
      // changed, not a second one forked beside it.
      expect(edited.entry.id).toBe(entryId);
      expect(edited.entry.source.repo).toBe(`git@github.com:${repo}.git`);

      // Correcting the source is the other half. The id derives from it, so the
      // entry moves rather than being stuck with the typo it was created with.
      const rekeyedFrom = entryId;
      const staleCard = page.getByTestId(`image-entry-${rekeyedFrom}`);
      await staleCard.getByRole('button', { name: 'Edit' }).click();

      const sourceDialog = page.getByRole('dialog');
      await expect(sourceDialog.getByLabel('Repository', { exact: true })).toHaveValue(
        `git@github.com:${repo}.git`,
      );
      await sourceDialog.getByLabel(/Dockerfile/).fill('container/Dockerfile.gpu');
      // The move is stated before the click, not discovered after it.
      await expect(sourceDialog.getByText(/keyed on its source, so this moves it/)).toBeVisible();
      await sourceDialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(sourceDialog).toBeHidden({ timeout: 60_000 });

      const afterRekey = await request.get(`/api/image-catalog?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH,
      });
      const { entries: afterEntries } = (await afterRekey.json()) as {
        entries: { id: string; source: { repo?: string; dockerfile?: string } }[];
      };
      const moved = afterEntries.find(
        (candidate) => candidate.source.dockerfile === 'container/Dockerfile.gpu',
      );
      expect(moved, 'the re-keyed entry is not in the catalog').toBeDefined();
      entryId = moved?.id ?? '';
      expect(entryId).not.toBe(rekeyedFrom);
      // One entry, corrected — not the mistake sitting beside its fix.
      expect(afterEntries.map((candidate) => candidate.id)).not.toContain(rekeyedFrom);
      const movedCard = page.getByTestId(`image-entry-${entryId}`);
      await expect(movedCard).toBeVisible({ timeout: 60_000 });

      // And withdrawing it entirely. Nothing was ever built from this repo, so
      // the daemon holds no image for the entry and the delete is the record
      // alone — the case the dialog has to name rather than promising to
      // destroy something that is not there.
      await movedCard.getByRole('button', { name: 'Delete' }).click();
      const deleteDialog = page.getByRole('dialog');
      await expect(deleteDialog.getByText(/removes the record and nothing else/)).toBeVisible();
      await deleteDialog.getByRole('button', { name: 'Delete entry' }).click();
      await expect(deleteDialog).toBeHidden({ timeout: 60_000 });

      // Gone from the view it was listed in, and gone from the read behind it.
      await expect(page.getByTestId(`image-entry-${entryId}`)).toHaveCount(0, {
        timeout: 60_000,
      });
      const afterDelete = await request.get(`/api/image-catalog?namespace=${TEST_ORG_HANDLE}`, {
        headers: AUTH,
      });
      const { entries: remaining } = (await afterDelete.json()) as { entries: { id: string }[] };
      expect(remaining.map((candidate) => candidate.id)).not.toContain(entryId);
      entryId = '';
    } finally {
      if (entryId !== '') {
        await request.delete(`/api/image-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, {
          headers: AUTH,
        });
      }
    }
  });
});
