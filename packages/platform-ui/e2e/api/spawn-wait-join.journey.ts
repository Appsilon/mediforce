import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';

/**
 * Spawn + wait join (issue #1215): a parent `wait` whose condition reads
 * `children.allCompleted` resolves once every run its `spawn` step fired has
 * finished — read from the children's own rows at sweep time, so this also
 * proves the spawned child's `parentInstanceId` survives Postgres.
 *
 * Children are a single verdict review, so the journey finishes them through
 * the task API; `POST /resume-wait` stands in for the heartbeat sweep that
 * calls the same handler.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const POLL_OPTIONS = { timeoutMs: 20_000, intervalMs: 250 };
const JOIN_CONDITION = 'children.allCompleted == true';

interface RunBody {
  status: string;
  pauseReason: string | null;
  variables: Record<string, unknown>;
}

async function registerWorkflow(request: APIRequestContext, wd: Record<string, unknown>): Promise<void> {
  const res = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: HEADERS,
    data: wd,
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function registerFamily(
  request: APIRequestContext,
  options: { childCount: number; wait: Record<string, unknown> },
): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const childName = `e2e-join-child-${suffix}`;
  const parentName = `e2e-join-parent-${suffix}`;

  await registerWorkflow(request, {
    name: childName,
    title: 'Join child',
    steps: [
      { id: 'review', name: 'Review', type: 'review', executor: 'human', allowedRoles: ['operator'] },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'review', to: 'done' }],
  });
  await registerWorkflow(request, {
    name: parentName,
    title: 'Join parent',
    steps: [
      {
        id: 'fan-out',
        name: 'Fan out',
        type: 'creation',
        executor: 'action',
        action: {
          kind: 'spawn',
          config: { targets: Array.from({ length: options.childCount }, () => ({ definitionName: childName })) },
        },
      },
      {
        id: 'join',
        name: 'Join',
        type: 'creation',
        executor: 'action',
        action: { kind: 'wait', config: options.wait },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [
      { from: 'fan-out', to: 'join' },
      { from: 'join', to: 'done' },
    ],
  });
  return parentName;
}

async function getRun(request: APIRequestContext, runId: string): Promise<RunBody> {
  const res = await request.get(`/api/processes/${runId}`, { headers: HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as RunBody;
}

async function startParentAndAwaitWait(request: APIRequestContext, parentName: string): Promise<string> {
  const res = await request.post('/api/processes', {
    headers: HEADERS,
    data: { namespace: TEST_ORG_HANDLE, definitionName: parentName, triggeredBy: 'e2e-test', triggerName: 'Start' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { run } = (await res.json()) as { run: { id: string } };

  await pollUntil(
    async () => {
      const body = await getRun(request, run.id);
      return body.pauseReason === 'waiting_for_timer' ? body : null;
    },
    { ...POLL_OPTIONS, description: `parent ${run.id} to park on its wait` },
  );
  return run.id;
}

function spawnedChildIds(parent: RunBody): string[] {
  const fanOut = parent.variables['fan-out'] as { spawned: Array<{ instanceId: string }> };
  return fanOut.spawned.map((entry) => entry.instanceId);
}

async function finishChild(request: APIRequestContext, childId: string): Promise<void> {
  const task = await pollUntil(
    async () => {
      const res = await request.get(`/api/tasks?instanceId=${childId}`, { headers: HEADERS });
      if (res.status() !== 200) return null;
      const body = (await res.json()) as { tasks: Array<{ id: string; stepId: string }> };
      return body.tasks.find((candidate) => candidate.stepId === 'review') ?? null;
    },
    { ...POLL_OPTIONS, description: `review task for child ${childId}` },
  );
  const res = await request.post(`/api/tasks/${task.id}/complete`, {
    headers: HEADERS,
    data: { kind: 'verdict', verdict: 'approve' },
  });
  expect(res.status(), await res.text()).toBe(200);
  await pollUntil(
    async () => ((await getRun(request, childId)).status === 'completed' ? true : null),
    { ...POLL_OPTIONS, description: `child ${childId} to complete` },
  );
}

async function resumeWait(
  request: APIRequestContext,
  runId: string,
): Promise<{ resumed: boolean; resumeReason?: string }> {
  const res = await request.post(`/api/processes/${runId}/resume-wait`, { headers: HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { resumed: boolean; resumeReason?: string };
}

async function expectParentCompletes(request: APIRequestContext, runId: string, resumeReason: string) {
  const parent = await pollUntil(
    async () => {
      const body = await getRun(request, runId);
      return body.status === 'completed' ? body : null;
    },
    { ...POLL_OPTIONS, description: `parent ${runId} to complete` },
  );
  expect(parent.variables.join).toMatchObject({ resumeReason });
}

test.describe('spawn + wait join on children.allCompleted — API E2E', () => {
  test('resolves early once every spawned child has finished', async ({ request }) => {
    const parentName = await registerFamily(request, {
      childCount: 2,
      wait: { duration: { hours: 1 }, condition: JOIN_CONDITION },
    });
    const parentId = await startParentAndAwaitWait(request, parentName);
    const [firstChild, secondChild] = spawnedChildIds(await getRun(request, parentId));

    await finishChild(request, firstChild);
    expect((await resumeWait(request, parentId)).resumed).toBe(false);

    await finishChild(request, secondChild);
    expect(await resumeWait(request, parentId)).toEqual({ resumed: true, resumeReason: 'condition_met' });
    await expectParentCompletes(request, parentId, 'condition_met');
  });

  test('resolves on the deadline with children still running', async ({ request }) => {
    const parentName = await registerFamily(request, {
      childCount: 1,
      wait: { deadline: new Date(Date.now() + 5_000).toISOString(), condition: JOIN_CONDITION },
    });
    const parentId = await startParentAndAwaitWait(request, parentName);

    const resumed = await pollUntil(
      async () => {
        const result = await resumeWait(request, parentId);
        return result.resumed ? result : null;
      },
      { ...POLL_OPTIONS, intervalMs: 1_000, description: `parent ${parentId} deadline` },
    );
    expect(resumed.resumeReason).toBe('deadline_reached');
    await expectParentCompletes(request, parentId, 'deadline_reached');

    const [childId] = spawnedChildIds(await getRun(request, parentId));
    expect((await getRun(request, childId)).status).not.toBe('completed');
  });

  test('resolves at once when the spawn fired no children', async ({ request }) => {
    const parentName = await registerFamily(request, {
      childCount: 0,
      wait: { duration: { hours: 1 }, condition: JOIN_CONDITION },
    });
    const parentId = await startParentAndAwaitWait(request, parentName);

    expect(await resumeWait(request, parentId)).toEqual({ resumed: true, resumeReason: 'condition_met' });
    await expectParentCompletes(request, parentId, 'condition_met');
  });
});
