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
      await derivedCard.getByRole('button').click();
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
});
