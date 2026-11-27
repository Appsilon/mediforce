import { execFileSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
} from '../helpers/multi-namespace';

/**
 * L3 API journey for the image prune sweep (#1698): route adapter →
 * `pruneDockerImages` → workflow definitions in Postgres + the real Docker
 * daemon.
 *
 * Every image here is a tag on `alpine`, which is months old, so it is "old"
 * without waiting; the recent one is a `docker commit`, created now. The sweep
 * is narrowed to this test's own tags, so it never touches what a parallel
 * journey — or the developer — has on the daemon.
 */

const OLD_BASE_IMAGE = 'alpine:3.22';

interface PruneResult {
  available: boolean;
  dryRun: boolean;
  pruned: { image: string }[];
  kept: { image: string; reason: string }[];
  failed: { image: string; error: string }[];
}

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

function imageExists(tag: string): boolean {
  try {
    docker('image', 'inspect', tag);
    return true;
  } catch {
    return false;
  }
}

/** An image created now, so it is younger than any minimum age. */
function commitRecentImage(tag: string): void {
  const container = `mediforce-e2e-prune-${tag.replace(/[^a-z0-9]/gi, '-')}`;
  docker('run', '--name', container, OLD_BASE_IMAGE, 'true');
  try {
    docker('commit', container, tag);
  } finally {
    docker('rm', '-f', container);
  }
}

async function registerVersion(
  request: APIRequestContext,
  workflowName: string,
  image: string,
): Promise<void> {
  const response = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: apiKeyHeaders(),
    data: {
      name: workflowName,
      title: `E2E prune ${workflowName}`,
      steps: [
        {
          id: 'analyse',
          name: 'Analyse',
          type: 'creation',
          executor: 'agent',
          autonomyLevel: 'L2',
          agent: { image },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'analyse', to: 'done' }],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function prune(
  request: APIRequestContext,
  body: { dryRun: boolean; images: string[] },
): Promise<PruneResult> {
  const response = await request.post('/api/admin/docker-images/prune', {
    headers: apiKeyHeaders(),
    data: body,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as PruneResult;
}

test.describe('image prune API journey', () => {
  test.beforeEach(() => {
    // Every request reads the daemon listing server-side; see image-catalog.journey.
    test.setTimeout(90_000);
  });

  test('deletes an old unreferenced image and keeps referenced or recent ones', async ({ request }) => {
    test.skip(!dockerAvailable(), 'Docker daemon not available');
    if (imageExists(OLD_BASE_IMAGE) === false) docker('pull', OLD_BASE_IMAGE);

    const stamp = Date.now();
    const unreferenced = `mediforce-artifacts:e2e-prune-orphan-${stamp}`;
    const livePinned = `mediforce-built:e2e-prune-live-${stamp}`;
    const supersededPinned = `mediforce-built:e2e-prune-superseded-${stamp}`;
    const recent = `mediforce-artifacts:e2e-prune-recent-${stamp}`;
    const workflowName = `e2e-prune-${stamp}`;
    const tags = [unreferenced, livePinned, supersededPinned, recent];

    docker('tag', OLD_BASE_IMAGE, unreferenced);
    docker('tag', OLD_BASE_IMAGE, livePinned);
    docker('tag', OLD_BASE_IMAGE, supersededPinned);
    commitRecentImage(recent);

    try {
      // v1 names the superseded image, v2 — the version runs start from — the
      // live one. v1 names its image outright, with nothing to rebuild it from,
      // so making v1 the default again must still find it on the daemon.
      await registerVersion(request, workflowName, supersededPinned);
      await registerVersion(request, workflowName, livePinned);

      const plan = await prune(request, { dryRun: true, images: tags });
      expect(plan.available).toBe(true);
      expect(plan.dryRun).toBe(true);
      expect(plan.pruned.map((row) => row.image)).toEqual([unreferenced]);
      expect(Object.fromEntries(plan.kept.map((row) => [row.image, row.reason]))).toEqual({
        [livePinned]: 'workflow',
        [supersededPinned]: 'workflow',
        [recent]: 'recent',
      });
      // A dry run destroys nothing.
      expect(imageExists(unreferenced)).toBe(true);

      const swept = await prune(request, { dryRun: false, images: tags });
      expect(swept.failed).toEqual([]);
      expect(swept.pruned.map((row) => row.image)).toEqual([unreferenced]);
      expect(imageExists(unreferenced)).toBe(false);
      expect(imageExists(livePinned)).toBe(true);
      expect(imageExists(supersededPinned)).toBe(true);
      expect(imageExists(recent)).toBe(true);
    } finally {
      for (const tag of tags) {
        try {
          docker('rmi', tag);
        } catch {
          // Already pruned by the sweep under test.
        }
      }
    }
  });

  test('a workspace owner is refused: the sweep judges every workspace', async ({ request }) => {
    // The fixture's member owns the test workspace, which is enough to delete
    // one image by hand — but they see only their own workspaces' runs.
    const callers = await setupMultiNamespaceCallers();
    const response = await request.post('/api/admin/docker-images/prune', {
      headers: { ...sessionCookieHeaders(callers.member), 'Content-Type': 'application/json' },
      data: { dryRun: true },
    });
    expect(response.status(), await response.text()).toBe(403);
  });
});
