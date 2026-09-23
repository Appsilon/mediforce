import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * API E2E for Step Evaluation 1a (ADR-0023 D8, D13): `agent.outputSchema`
 * enforcement, Agent Trajectory persistence, and the `human_verdict` Score a
 * Control Mode 3 review writes.
 *
 * Every run is driven through the platform with MOCK_AGENT=true. The mock
 * agent's result is `{ mock, summary }` and it records two trajectory entries
 * per attempt, which is what these assertions lean on.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY };

interface AgentRunRow {
  id: string;
  stepId: string;
  status: string;
  fallbackReason: string | null;
}

interface TrajectoryEntry {
  seq: number;
  type: string;
  subtype?: string;
  text?: string;
  redacted?: true;
}

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  { timeoutMs = 20_000, intervalMs = 250, description = 'condition' }: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`);
}

async function startRun(request: APIRequestContext, wd: Record<string, unknown>): Promise<string> {
  const createWdRes = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
    headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
    data: wd,
  });
  expect(createWdRes.status(), await createWdRes.text()).toBe(201);

  const triggerRes = await request.post('/api/processes', {
    headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
    data: { namespace: TEST_ORG_HANDLE, definitionName: wd.name, triggeredBy: 'e2e-test', triggerName: 'Start' },
  });
  expect(triggerRes.status(), await triggerRes.text()).toBe(201);
  const { run } = (await triggerRes.json()) as { run: { id: string } };
  return run.id;
}

async function awaitFinishedAgentRun(request: APIRequestContext, runId: string): Promise<AgentRunRow> {
  return pollUntil(
    async () => {
      const res = await request.get(`/api/agent-runs?runId=${runId}`, { headers: AUTH_HEADERS });
      if (res.status() !== 200) return null;
      const { runs } = (await res.json()) as { runs: AgentRunRow[] };
      return runs.find((agentRun) => agentRun.status !== 'running') ?? null;
    },
    { description: `a finished agent run in ${runId}` },
  );
}

async function getTrajectory(request: APIRequestContext, agentRunId: string): Promise<TrajectoryEntry[]> {
  const res = await request.get(`/api/agent-runs/${agentRunId}/trajectory`, { headers: AUTH_HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { agentRunId: string; entries: TrajectoryEntry[] };
  expect(body.agentRunId).toBe(agentRunId);
  return body.entries;
}

function agentStepWorkflow(name: string, step: Record<string, unknown>): Record<string, unknown> {
  return {
    name,
    title: name,
    steps: [
      { id: 'grade-aes', name: 'Grade adverse events', type: 'creation', executor: 'agent', ...step },
      { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
    ],
    transitions: [{ from: 'grade-aes', to: 'done' }],
  };
}

test.describe('Step Evaluation foundations — API E2E', () => {
  test('a result that breaks agent.outputSchema is retried once, then routed to fallbackBehavior', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-output-schema-${Date.now()}`, {
      autonomyLevel: 'L4',
      agent: {
        prompt: 'Grade each adverse event by CTCAE.',
        outputSchema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array' } } },
        fallbackBehavior: 'escalate_to_human',
      },
    }));

    const agentRun = await awaitFinishedAgentRun(request, runId);
    expect(agentRun.status).toBe('escalated');
    expect(agentRun.fallbackReason).toBe('output_schema');

    const eventsRes = await request.get(`/api/processes/${runId}/agent-events?stepId=grade-aes`, { headers: AUTH_HEADERS });
    expect(eventsRes.status()).toBe(200);
    const { events } = (await eventsRes.json()) as { events: Array<{ type: string; payload: unknown }> };
    expect(events.filter((event) => event.type === 'result')).toHaveLength(2);
    expect(events.some((event) =>
      event.type === 'status' && String(event.payload).includes('missing required keys: findings'),
    )).toBe(true);

    // Both attempts land in the one Agent Run's trajectory.
    const entries = await getTrajectory(request, agentRun.id);
    expect(entries.map((entry) => entry.seq)).toEqual([0, 1, 2, 3]);

    const run = await pollUntil(
      async () => {
        const res = await request.get(`/api/processes/${runId}`, { headers: AUTH_HEADERS });
        const body = (await res.json()) as { status: string; pauseReason: string | null };
        return body.status === 'paused' ? body : null;
      },
      { description: `run ${runId} to pause` },
    );
    expect(run.pauseReason).toBe('agent_escalated');
  });

  test('an agent run\'s trajectory is retrievable by its id, and scoped like the run', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-trajectory-${Date.now()}`, { autonomyLevel: 'L4' }));

    const agentRun = await awaitFinishedAgentRun(request, runId);
    expect(agentRun.status).toBe('completed');

    const entries = await getTrajectory(request, agentRun.id);
    expect(entries.map((entry) => [entry.seq, entry.type, entry.subtype])).toEqual([
      [0, 'assistant', 'text'],
      [1, 'result', 'success'],
    ]);

    const unknownRes = await request.get('/api/agent-runs/00000000-0000-4000-8000-000000000000/trajectory', { headers: AUTH_HEADERS });
    expect(unknownRes.status()).toBe(404);

    const malformedRes = await request.get('/api/agent-runs/not-a-run-id/trajectory', { headers: AUTH_HEADERS });
    expect(malformedRes.status()).toBe(400);
  });

  test('a CM3 approval records a human_verdict Score on the reviewed agent run', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-human-verdict-${Date.now()}`, {
      autonomyLevel: 'L3',
      allowedRoles: ['operator'],
    }));

    const task = await pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: AUTH_HEADERS });
        if (res.status() !== 200) return null;
        const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string }> };
        return tasks.find((candidate) => candidate.stepId === 'grade-aes' && candidate.status !== 'completed') ?? null;
      },
      { description: `CM3 review task for ${runId}` },
    );

    const [agentRun] = await pollUntil(
      async () => {
        const res = await request.get(`/api/agent-runs?runId=${runId}`, { headers: AUTH_HEADERS });
        const { runs } = (await res.json()) as { runs: AgentRunRow[] };
        return runs.length > 0 ? runs : null;
      },
      { description: `agent run in ${runId}` },
    );

    const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      data: { kind: 'verdict', verdict: 'approve', comment: 'Grades match CTCAE v5' },
    });
    expect(completeRes.status(), await completeRes.text()).toBe(200);

    const scoresRes = await request.get(`/api/scores?agentRunId=${agentRun!.id}`, { headers: AUTH_HEADERS });
    expect(scoresRes.status(), await scoresRes.text()).toBe(200);
    const { scores } = (await scoresRes.json()) as { scores: Array<Record<string, unknown>> };
    expect(scores).toHaveLength(1);
    expect(scores[0]).toMatchObject({
      subject: { type: 'agent_run', id: agentRun!.id },
      name: 'human_verdict',
      value: 1,
      label: 'approve',
      comment: 'Grades match CTCAE v5',
      source: 'human',
      namespace: TEST_ORG_HANDLE,
      processInstanceId: runId,
      stepId: 'grade-aes',
    });

    const byRunRes = await request.get(`/api/scores?runId=${runId}&stepId=grade-aes&name=human_verdict`, { headers: AUTH_HEADERS });
    expect(((await byRunRes.json()) as { scores: unknown[] }).scores).toHaveLength(1);

    const auditRes = await request.get(`/api/processes/${runId}/audit`, { headers: AUTH_HEADERS });
    const { events } = (await auditRes.json()) as { events: Array<{ action: string; entityId: string }> };
    expect(events.some((event) => event.action === 'score.created' && event.entityId === scores[0]!.id)).toBe(true);
  });
});
