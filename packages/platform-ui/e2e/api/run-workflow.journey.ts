import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';

/**
 * `run-workflow`: one step spawns a single child, parks the parent on it, and
 * resumes with exactly that child's result — `{ instanceId, definitionName,
 * status, error, output }`. A child ending wakes its parent on the spot (and a
 * parent that parks after its child already ended resumes as it parks), so only
 * the timeout test pokes `POST /resume-wait`: a timeout has no event behind it,
 * and the heartbeat sweep that calls the same handler is what resolves it.
 *
 * Children are Docker-free: a `reshape` that completes at once, an `http` call
 * to a closed port that fails, or a human review nobody finishes.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
const POLL_OPTIONS = { timeoutMs: 20_000, intervalMs: 250 };

interface RunBody {
  status: string;
  pauseReason: string | null;
  variables: Record<string, unknown>;
}

interface ChildResult {
  instanceId: string;
  definitionName: string;
  status: string;
  error: string | null;
  output: unknown;
}

type ChildKind = 'completes' | 'fails' | 'never-ends';

const CHILD_STEPS: Record<ChildKind, Record<string, unknown>> = {
  completes: {
    id: 'result',
    name: 'Result',
    type: 'creation',
    executor: 'action',
    action: { kind: 'reshape', config: { values: { outcome: 'ready' } } },
  },
  fails: {
    id: 'result',
    name: 'Result',
    type: 'creation',
    executor: 'action',
    action: { kind: 'http', config: { method: 'GET', url: 'http://127.0.0.1:1/unreachable' } },
  },
  'never-ends': {
    id: 'result',
    name: 'Result',
    type: 'review',
    executor: 'human',
    allowedRoles: ['operator'],
  },
};

async function registerWorkflow(request: APIRequestContext, wd: Record<string, unknown>): Promise<void> {
  const res = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: HEADERS,
    data: wd,
  });
  expect(res.status(), await res.text()).toBe(201);
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function registerChild(request: APIRequestContext, kind: ChildKind): Promise<string> {
  const childName = `e2e-run-workflow-child-${uniqueSuffix()}`;
  await registerWorkflow(request, {
    name: childName,
    title: 'Run-workflow child',
    steps: [CHILD_STEPS[kind], { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
    transitions: [{ from: 'result', to: 'done' }],
  });
  return childName;
}

function runStep(childName: string, timeout: string): Record<string, unknown> {
  return {
    id: 'run',
    name: 'Run child',
    type: 'creation',
    executor: 'action',
    action: { kind: 'run-workflow', config: { definitionName: childName, timeout, step: 'result' } },
  };
}

async function registerParent(request: APIRequestContext, childName: string, timeout: string): Promise<string> {
  const parentName = `e2e-run-workflow-parent-${uniqueSuffix()}`;
  await registerWorkflow(request, {
    name: parentName,
    title: 'Run-workflow parent',
    steps: [runStep(childName, timeout), { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
    transitions: [{ from: 'run', to: 'done' }],
  });
  return parentName;
}

async function startRun(request: APIRequestContext, definitionName: string): Promise<string> {
  const res = await request.post('/api/processes', {
    headers: HEADERS,
    data: { namespace: TEST_ORG_HANDLE, definitionName, triggeredBy: 'e2e-test', triggerName: 'Start' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { run } = (await res.json()) as { run: { id: string } };
  return run.id;
}

async function getRun(request: APIRequestContext, runId: string): Promise<RunBody> {
  const res = await request.get(`/api/processes/${runId}`, { headers: HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as RunBody;
}

async function awaitStatus(request: APIRequestContext, runId: string, status: string): Promise<RunBody> {
  return pollUntil(
    async () => {
      const body = await getRun(request, runId);
      return body.status === status ? body : null;
    },
    { ...POLL_OPTIONS, description: `run ${runId} to be ${status}` },
  );
}

async function completeTask(request: APIRequestContext, runId: string, stepId: string, verdict: string): Promise<void> {
  const task = await pollUntil(
    async () => {
      const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: HEADERS });
      if (res.status() !== 200) return null;
      const body = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string }> };
      return body.tasks.find((candidate) => candidate.stepId === stepId && candidate.status !== 'completed') ?? null;
    },
    { ...POLL_OPTIONS, description: `open '${stepId}' task on ${runId}` },
  );
  const res = await request.post(`/api/tasks/${task.id}/complete`, {
    headers: HEADERS,
    data: { kind: 'verdict', verdict },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('run-workflow action — API E2E', () => {
  test('resumes the parent with the child output once the child completes', async ({ request }) => {
    const childName = await registerChild(request, 'completes');
    const parentId = await startRun(request, await registerParent(request, childName, 'PT1H'));

    const parent = await awaitStatus(request, parentId, 'completed');
    const result = parent.variables.run as ChildResult;
    expect(result).toMatchObject({
      definitionName: childName,
      status: 'completed',
      error: null,
      output: { outcome: 'ready' },
    });
    expect((await getRun(request, result.instanceId)).status).toBe('completed');
  });

  test('resumes the parent with status failed when the child fails', async ({ request }) => {
    const childName = await registerChild(request, 'fails');
    const parentId = await startRun(request, await registerParent(request, childName, 'PT1H'));

    const parent = await awaitStatus(request, parentId, 'completed');
    const result = parent.variables.run as ChildResult;
    expect(result.status).toBe('failed');
    expect(result.error).toEqual(expect.stringContaining('unreachable'));
    expect(result.output).toBeNull();
  });

  test('resumes with the unfinished child status once the timeout passes', async ({ request }) => {
    const childName = await registerChild(request, 'never-ends');
    const parentId = await startRun(request, await registerParent(request, childName, 'PT5S'));
    await pollUntil(
      async () => ((await getRun(request, parentId)).pauseReason === 'waiting_for_timer' ? true : null),
      { ...POLL_OPTIONS, description: `parent ${parentId} to park on its child` },
    );

    const resumed = await pollUntil(
      async () => {
        const res = await request.post(`/api/processes/${parentId}/resume-wait`, { headers: HEADERS });
        expect(res.status(), await res.text()).toBe(200);
        const body = (await res.json()) as { resumed: boolean; resumeReason?: string };
        return body.resumed ? body : null;
      },
      { ...POLL_OPTIONS, intervalMs: 1_000, description: `parent ${parentId} timeout` },
    );
    expect(resumed.resumeReason).toBe('deadline_reached');

    const parent = await awaitStatus(request, parentId, 'completed');
    const result = parent.variables.run as ChildResult;
    expect(result.status).not.toBe('completed');
    expect(result.output).toBeNull();
    expect((await getRun(request, result.instanceId)).status).not.toBe('completed');
  });

  test('a loop that runs the step twice returns the second child, not the first', async ({ request }) => {
    const childName = await registerChild(request, 'completes');
    const parentName = `e2e-run-workflow-loop-${uniqueSuffix()}`;
    await registerWorkflow(request, {
      name: parentName,
      title: 'Run-workflow loop',
      steps: [
        runStep(childName, 'PT1H'),
        {
          id: 'check',
          name: 'Check',
          type: 'review',
          executor: 'human',
          allowedRoles: ['operator'],
          verdicts: { again: { target: 'run' }, accept: { target: 'done' } },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [
        { from: 'run', to: 'check' },
        { from: 'check', to: 'run' },
        { from: 'check', to: 'done' },
      ],
    });
    const parentId = await startRun(request, parentName);

    const firstPass = await pollUntil(
      async () => {
        const body = await getRun(request, parentId);
        return body.pauseReason === 'waiting_for_human' ? body : null;
      },
      { ...POLL_OPTIONS, description: `parent ${parentId} to reach its first check` },
    );
    const firstChildId = (firstPass.variables.run as ChildResult).instanceId;

    await completeTask(request, parentId, 'check', 'again');
    const secondPass = await pollUntil(
      async () => {
        const body = await getRun(request, parentId);
        const result = body.variables.run as ChildResult | undefined;
        return body.pauseReason === 'waiting_for_human' && result?.instanceId !== firstChildId ? body : null;
      },
      { ...POLL_OPTIONS, description: `parent ${parentId} to reach its second check with a new child` },
    );
    const secondResult = secondPass.variables.run as ChildResult;
    expect(secondResult).toMatchObject({ status: 'completed', output: { outcome: 'ready' } });

    await completeTask(request, parentId, 'check', 'accept');
    const parent = await awaitStatus(request, parentId, 'completed');
    expect((parent.variables.run as ChildResult).instanceId).toBe(secondResult.instanceId);
  });
});
