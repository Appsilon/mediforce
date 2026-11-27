import { existsSync } from 'node:fs';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { setPostgresRunStatus } from '../helpers/postgres-seed';
import { removeRunWorktrees, runWorktreePath, seedOutputFiles, seedRunWorktree } from '../helpers/seed-output-files';

/**
 * POST /api/cron/heartbeat removes the worktrees of finished runs:
 * a completed run's at once, a failed run's once the retry grace period has
 * passed, an active run's never. Only the checkout goes: the run branch stays
 * in the bare repo, so the run's Output Files are still listed and downloaded.
 *
 * Worktrees and branches are seeded with git directly, as the Output Files
 * journey does: under MOCK_AGENT=true no step commits to the workspace.
 * Statuses are set in Postgres, since no endpoint finishes or backdates a run.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY };
const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' };
const FAILED_RUN_GRACE_PASSED = new Date(Date.now() - 25 * 60 * 60 * 1000);

test.describe('Run worktree sweep — API E2E', () => {
  const wdName = `e2e-worktree-sweep-${Date.now()}`;
  const reportCsv = 'study,grade\nS-001,2\n';

  async function startRun(request: APIRequestContext): Promise<string> {
    const res = await request.post('/api/processes', {
      headers: JSON_HEADERS,
      data: { namespace: TEST_ORG_HANDLE, definitionName: wdName, triggeredBy: 'e2e-test', triggerName: 'Start' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { run } = (await res.json()) as { run: { id: string } };
    // Settle before the status is set underneath: the auto-runner's own write
    // of the paused human step would otherwise land on top of it.
    await pollUntil(
      async () => {
        const runRes = await request.get(`/api/runs/${run.id}`, { headers: AUTH_HEADERS });
        const body = (await runRes.json()) as { status: string };
        return body.status === 'paused' ? body : null;
      },
      { description: `run ${run.id} to wait at its human step` },
    );
    await seedOutputFiles(wdName, run.id, { review: { 'report.csv': reportCsv } });
    await seedRunWorktree(wdName, run.id);
    return run.id;
  }

  test.afterAll(async ({ request }) => {
    await removeRunWorktrees(wdName);
    const countRes = await request.get(
      `/api/workflow-definitions/${encodeURIComponent(wdName)}/run-count?namespace=${TEST_ORG_HANDLE}`,
      { headers: AUTH_HEADERS },
    );
    const expectedRunCount = countRes.ok() ? ((await countRes.json()) as { count: number }).count : 0;
    await request.delete(`/api/workflow-definitions/${encodeURIComponent(wdName)}?namespace=${TEST_ORG_HANDLE}`, {
      headers: AUTH_HEADERS,
      data: { expectedRunCount },
    });
  });

  test('removes finished runs\' worktrees and keeps their Output Files', async ({ request }) => {
    const createWdRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
      headers: JSON_HEADERS,
      data: {
        name: wdName,
        title: 'E2E worktree sweep',
        steps: [
          { id: 'review', name: 'Review', type: 'creation', executor: 'human' },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'review', to: 'done' }],
      },
    });
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    const completedRun = await startRun(request);
    const failedStaleRun = await startRun(request);
    const failedRecentRun = await startRun(request);
    const activeRun = await startRun(request);
    await setPostgresRunStatus(completedRun, 'completed', new Date());
    await setPostgresRunStatus(failedStaleRun, 'failed', FAILED_RUN_GRACE_PASSED);
    await setPostgresRunStatus(failedRecentRun, 'failed', new Date());

    // Other journeys' finished runs share the data dir, and a beat removes a
    // bounded number of worktrees, so beat until ours are gone.
    await pollUntil(
      async () => {
        const beat = await request.post('/api/cron/heartbeat', { headers: AUTH_HEADERS });
        expect(beat.status(), await beat.text()).toBe(200);
        const swept = [completedRun, failedStaleRun].every((runId) => existsSync(runWorktreePath(wdName, runId)) === false);
        return swept ? true : null;
      },
      { description: 'the heartbeat to remove the finished runs\' worktrees', intervalMs: 1000 },
    );

    expect(existsSync(runWorktreePath(wdName, failedRecentRun))).toBe(true);
    expect(existsSync(runWorktreePath(wdName, activeRun))).toBe(true);

    const listRes = await request.get(`/api/runs/${completedRun}/files`, { headers: AUTH_HEADERS });
    expect(listRes.status(), await listRes.text()).toBe(200);
    expect(await listRes.json()).toEqual({
      files: [
        {
          stepId: 'review',
          name: 'report.csv',
          path: '.mediforce/output/review/report.csv',
          size: Buffer.byteLength(reportCsv),
        },
      ],
    });

    const downloadRes = await request.get(`/api/runs/${completedRun}/files/.mediforce/output/review/report.csv`, {
      headers: AUTH_HEADERS,
    });
    expect(downloadRes.status(), await downloadRes.text()).toBe(200);
    expect((await downloadRes.body()).toString('utf-8')).toBe(reportCsv);
  });
});
