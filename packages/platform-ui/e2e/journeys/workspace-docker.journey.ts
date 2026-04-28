/**
 * End-to-end API test for the Docker-backed workspace path — full feature flow.
 *
 * Drives a real multi-step workflow run through the public API, no browser,
 * no mocked plugin internals:
 *
 *   1. POST /api/workflow-definitions with two script-container steps:
 *      step 1 writes `step-1.md` into /workspace,
 *      step 2 asserts step 1's file is visible and writes `step-2.md`.
 *   2. POST /api/processes to trigger a run.
 *   3. Poll /api/processes/:id until the run reaches a terminal status.
 *   4. Assert the host-side workspace: bare repo exists, the run branch carries
 *      three commits (initial .gitignore seed + one per step), and both files
 *      are present in the worktree — proving inter-step file visibility and
 *      real per-step commits.
 *
 * Requires Docker. Skipped when the daemon isn't reachable.
 * Relies on `MEDIFORCE_DATA_DIR=/tmp/mediforce-e2e-data` on the dev server.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const DATA_DIR = '/tmp/mediforce-e2e-data';
// CI overrides PLATFORM_API_KEY via the workflow env; locally bootstrap_e2e.py
// writes `test-api-key` into .env.local. Read from env with a local fallback so
// both paths work.
const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH = { 'X-Api-Key': API_KEY };
const POLL_INTERVAL_MS = 1_500;
// CI is notably slower than local: image pulls, cold Docker daemon, shared runner.
// Two container spawns + polling can take a few minutes. Budget 5.
const POLL_TIMEOUT_MS = 300_000;

/** Minimal image for the inline bash scripts. */
const TEST_IMAGE = 'debian:bookworm-slim';

async function pollUntilTerminal(
  request: import('@playwright/test').APIRequestContext,
  instanceId: string,
): Promise<{ status: string; error: string | null }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/processes/${instanceId}`, { headers: AUTH });
    if (res.ok()) {
      const inst = (await res.json()) as { status: string; error: string | null };
      if (inst.status === 'completed' || inst.status === 'failed') return inst;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Run ${instanceId} did not reach terminal status within ${POLL_TIMEOUT_MS}ms`);
}

test.describe('Docker-backed workspace E2E', () => {
  test.describe.configure({ timeout: 360_000, retries: 0 });

  // Skipped on CI AND broken locally — tracked in #239.
  // Root cause: server-side API routes use the Firebase client SDK, which sends
  // requests without an auth token in emulator mode. firestore.rules then deny
  // the write (request.auth = null), the handler bubbles the FirebaseError as
  // a 500, and the test fails at the first POST before the workspace flow even
  // starts. Fix is server-side admin SDK adoption — out of scope for #213.
  test.skip(process.env.CI === 'true', 'Blocked by #239 (Firestore rules + client-SDK auth)');
  test.skip(!dockerAvailable(), 'Docker daemon not available');

  test.beforeAll(() => {
    try {
      execSync(`docker image inspect ${TEST_IMAGE}`, { stdio: 'pipe' });
    } catch {
      execSync(`docker pull ${TEST_IMAGE}`, { stdio: 'pipe' });
    }
  });

  test('multi-step run commits per step, next step sees prior step files, run branch carries full history', async ({ request }) => {
    const wdName = `e2e-docker-${Date.now()}`;
    const wd = {
      name: wdName,
      description: 'E2E: Docker + multi-step workspace with real commits',
      steps: [
        {
          id: 'step-1',
          name: 'Write step-1.md',
          type: 'creation',
          executor: 'script',
          plugin: 'script-container',
          autonomyLevel: 'L4',
          agent: {
            image: TEST_IMAGE,
            command: 'bash -c "echo step 1 content > /workspace/step-1.md && echo \'{\\"ok\\":true}\' > /output/result.json"',
          },
        },
        {
          id: 'step-2',
          name: 'Read step 1, write step-2.md',
          type: 'creation',
          executor: 'script',
          plugin: 'script-container',
          autonomyLevel: 'L4',
          agent: {
            image: TEST_IMAGE,
            // Fails hard if /workspace/step-1.md isn't there — proves inter-step file visibility.
            command: 'bash -c "test -f /workspace/step-1.md && cp /workspace/step-1.md /workspace/step-2.md && echo \'{\\"ok\\":true}\' > /output/result.json"',
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'step-1', to: 'step-2' },
        { from: 'step-2', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'start' }],
      workspace: {},
    };

    // Belt-and-braces cleanup (WD names are unique per run but this guards against re-runs).
    const bareRepoPath = join(DATA_DIR, 'bare-repos', TEST_ORG_HANDLE, `${wdName}.git`);
    rmSync(bareRepoPath, { recursive: true, force: true });
    rmSync(join(DATA_DIR, 'worktrees', TEST_ORG_HANDLE, wdName), { recursive: true, force: true });

    // 1. Register the workflow.
    const createRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      { headers: AUTH, data: wd },
    );
    expect(createRes.status(), await createRes.text()).toBe(201);

    // 2. Trigger a run.
    const triggerRes = await request.post('/api/processes', {
      headers: AUTH,
      data: { definitionName: wdName, triggeredBy: 'e2e-docker-test' },
    });
    expect(triggerRes.status(), await triggerRes.text()).toBe(201);
    const { instanceId } = (await triggerRes.json()) as { instanceId: string };

    // 3. Poll to terminal.
    const final = await pollUntilTerminal(request, instanceId);
    expect(final.status, `Run ended in ${final.status}: ${final.error ?? '<no error>'}`).toBe('completed');

    // 4a. Bare repo exists with both branches.
    expect(existsSync(bareRepoPath)).toBe(true);
    const branches = execSync(`git --git-dir="${bareRepoPath}" branch --list`, { encoding: 'utf-8' });
    expect(branches).toContain(`run/${instanceId}`);
    expect(branches).toContain('main');

    // 4b. Run branch carries three commits: initial .gitignore seed + one per step.
    const log = execSync(`git --git-dir="${bareRepoPath}" log run/${instanceId} --oneline`, { encoding: 'utf-8' }).trim();
    const commitLines = log.split('\n').filter(Boolean);
    expect(commitLines.length, `Expected 3 commits, got:\n${log}`).toBe(3);
    expect(log).toMatch(/step-1/);
    expect(log).toMatch(/step-2/);

    // 4c. Worktree on disk contains both files — step 2 saw step 1's output.
    const wtDir = join(DATA_DIR, 'worktrees', TEST_ORG_HANDLE, wdName, instanceId);
    expect(readFileSync(join(wtDir, 'step-1.md'), 'utf-8').trim()).toBe('step 1 content');
    expect(readFileSync(join(wtDir, 'step-2.md'), 'utf-8').trim()).toBe('step 1 content');
  });
});
