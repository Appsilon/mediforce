import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';

/**
 * Spawn + wait join: a parent `wait` whose condition reads
 * `children.allFinished` resolves once every run its `spawn` step fired has
 * finished — read from the children's own rows at sweep time, so this also
 * proves the spawned child's `parentInstanceId` survives Postgres.
 *
 * The join is event-driven: a child ending resumes its parent on the spot, and
 * a parent that parks after its children already ended resumes as it parks, so
 * the join tests never poke `POST /resume-wait`. Only the deadline test does —
 * a deadline has no event behind it, so the heartbeat sweep that calls the same
 * handler is what resolves it. After the join, a `collect` step hands the parent
 * what its children produced.
 *
 * Children are a single verdict review, so the journey finishes them through
 * the task API.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const POLL_OPTIONS = { timeoutMs: 20_000, intervalMs: 250 };
const JOIN_CONDITION = 'children.allFinished == true';

interface RunBody {
  status: string;
  pauseReason: string | null;
  variables: Record<string, unknown>;
}

interface CollectedOutput {
  count: number;
  completedCount: number;
  children: Array<{ instanceId: string; status: string; output: unknown }>;
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
      {
        id: 'collect',
        name: 'Collect',
        type: 'creation',
        executor: 'action',
        action: { kind: 'collect', config: { step: 'review' } },
      },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [
      { from: 'fan-out', to: 'join' },
      { from: 'join', to: 'collect' },
      { from: 'collect', to: 'done' },
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

test.describe('spawn + wait join on children.allFinished — API E2E', () => {
  test('resumes the parent the moment its last child finishes, then collects their results', async ({ request }) => {
    const parentName = await registerFamily(request, {
      childCount: 2,
      wait: { duration: { hours: 1 }, condition: JOIN_CONDITION },
    });
    const parentId = await startParentAndAwaitWait(request, parentName);
    const [firstChild, secondChild] = spawnedChildIds(await getRun(request, parentId));

    await finishChild(request, firstChild);
    const stillWaiting = await getRun(request, parentId);
    expect(stillWaiting.status).toBe('paused');
    expect(stillWaiting.pauseReason).toBe('waiting_for_timer');

    await finishChild(request, secondChild);
    await expectParentCompletes(request, parentId, 'condition_met');

    const parent = await getRun(request, parentId);
    const collected = parent.variables.collect as CollectedOutput;
    expect(collected.count).toBe(2);
    expect(collected.completedCount).toBe(2);
    expect(collected.children.map((child) => child.instanceId).sort()).toEqual([firstChild, secondChild].sort());
    for (const child of collected.children) {
      expect(child.status).toBe('completed');
      expect(child.output).not.toBeNull();
    }
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

    const parent = await getRun(request, parentId);
    const [childId] = spawnedChildIds(parent);
    expect((await getRun(request, childId)).status).not.toBe('completed');

    const collected = parent.variables.collect as CollectedOutput;
    expect(collected.count).toBe(1);
    expect(collected.completedCount).toBe(0);
    expect(collected.children).toHaveLength(1);
    expect(collected.children[0]?.instanceId).toBe(childId);
    expect(collected.children[0]?.status).not.toBe('completed');
    expect(collected.children[0]?.output).toBeNull();
  });

  test('resolves at once when the spawn fired no children', async ({ request }) => {
    const parentName = await registerFamily(request, {
      childCount: 0,
      wait: { duration: { hours: 1 }, condition: JOIN_CONDITION },
    });
    const res = await request.post('/api/processes', {
      headers: HEADERS,
      data: { namespace: TEST_ORG_HANDLE, definitionName: parentName, triggeredBy: 'e2e-test', triggerName: 'Start' },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { run } = (await res.json()) as { run: { id: string } };

    await expectParentCompletes(request, run.id, 'condition_met');
  });
});
