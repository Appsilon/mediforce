import type { APIRequestContext } from '@playwright/test';
import type { AgentRun, StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import {
  GetAgentTrajectoryOutputSchema,
  ListAgentRunsOutputSchema,
  ListScoresOutputSchema,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import {
  setupMultiNamespaceCallers,
  sessionCookieHeaders,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * API E2E for the evaluation groundwork on agent steps (ADR-0023 D8, D13):
 * a result that breaks `agent.outputSchema` is retried once and then routed to
 * `fallbackBehavior`; every Agent Run's Agent Trajectory is persisted and
 * readable only from the run's workspace; and a Control Mode 3 review verdict
 * is recorded as a `human_verdict` Score on the reviewed Agent Run, likewise
 * invisible from other workspaces.
 *
 * Every run is driven through the platform with MOCK_AGENT=true. The mock
 * agent's result is `{ mock, summary }` and it records two trajectory entries
 * per attempt, which is what these assertions lean on.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const AUTH_HEADERS = { 'X-Api-Key': API_KEY };

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

async function listAgentRuns(request: APIRequestContext, runId: string): Promise<AgentRun[] | null> {
  const res = await request.get(`/api/agent-runs?runId=${runId}`, { headers: AUTH_HEADERS });
  if (res.status() !== 200) return null;
  return ListAgentRunsOutputSchema.parse(await res.json()).runs;
}

async function awaitFinishedAgentRun(request: APIRequestContext, runId: string): Promise<AgentRun> {
  return pollUntil(
    async () => {
      const runs = await listAgentRuns(request, runId);
      if (runs === null) return null;
      return runs.find((agentRun) => agentRun.status !== 'running') ?? null;
    },
    { description: `a finished agent run in ${runId}` },
  );
}

async function getTrajectory(
  request: APIRequestContext,
  agentRunId: string,
  headers: Record<string, string> = AUTH_HEADERS,
): Promise<StoredAgentTrajectoryEntry[]> {
  const res = await request.get(`/api/agent-runs/${agentRunId}/trajectory`, { headers });
  expect(res.status(), await res.text()).toBe(200);
  const body = GetAgentTrajectoryOutputSchema.parse(await res.json());
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
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

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

  test('an agent run\'s trajectory is retrievable by its id, and scoped to the run\'s workspace', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-trajectory-${Date.now()}`, { autonomyLevel: 'L4' }));

    const agentRun = await awaitFinishedAgentRun(request, runId);
    expect(agentRun.status).toBe('completed');

    const entries = await getTrajectory(request, agentRun.id);
    expect(entries.map((entry) => [entry.seq, entry.type, entry.subtype])).toEqual([
      [0, 'assistant', 'text'],
      [1, 'result', 'success'],
    ]);

    // A member of the run's workspace reads it with a session; a user from
    // another workspace gets the same 404 as for a run that does not exist.
    const memberEntries = await getTrajectory(request, agentRun.id, sessionCookieHeaders(callers.member));
    expect(memberEntries).toEqual(entries);

    const outsiderRes = await request.get(`/api/agent-runs/${agentRun.id}/trajectory`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(outsiderRes.status(), await outsiderRes.text()).toBe(404);

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
        const runs = await listAgentRuns(request, runId);
        return runs !== null && runs.length > 0 ? runs : null;
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
    const { scores } = ListScoresOutputSchema.parse(await scoresRes.json());
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
    expect(ListScoresOutputSchema.parse(await byRunRes.json()).scores).toHaveLength(1);

    // Scores are listed through the caller's workspaces: another workspace's
    // user sees none of them, even when filtering by this Agent Run's id.
    const outsiderScoresRes = await request.get(`/api/scores?agentRunId=${agentRun!.id}`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(outsiderScoresRes.status(), await outsiderScoresRes.text()).toBe(200);
    expect(ListScoresOutputSchema.parse(await outsiderScoresRes.json()).scores).toEqual([]);

    const auditRes = await request.get(`/api/processes/${runId}/audit`, { headers: AUTH_HEADERS });
    const { events } = (await auditRes.json()) as { events: Array<{ action: string; entityId: string }> };
    expect(events.some((event) => event.action === 'score.created' && event.entityId === scores[0]!.id)).toBe(true);
  });
});
