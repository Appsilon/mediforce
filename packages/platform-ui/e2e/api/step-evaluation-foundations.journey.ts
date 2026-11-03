import type { APIRequestContext } from '@playwright/test';
import type { StoredAgentTrajectoryEntry } from '@mediforce/platform-core';
import {
  GetAgentRunIoOutputSchema,
  GetAgentTrajectoryOutputSchema,
  EvalCaseOutputSchema,
  ListScoresOutputSchema,
} from '@mediforce/platform-api/contract';
import {
  AUTH_HEADERS,
  JSON_HEADERS,
  agentStepWorkflow,
  awaitFinishedAgentRun,
  listAgentRuns,
  startRun,
} from '../helpers/agent-step-runs';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { scriptOpenRouter } from '../helpers/mock-openrouter-server';
import {
  setupMultiNamespaceCallers,
  sessionCookieHeaders,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * API E2E for the evaluation groundwork on agent steps (ADR-0023 D8, D13):
 * a result that breaks `agent.outputSchema` is reshaped by one LLM call — the
 * agent is not rerun — and escalated to a person, with the reason on the run,
 * when that cannot fix it; every Agent Run's Agent Trajectory is persisted and
 * readable only from the run's workspace; and a Control Mode 3 review verdict
 * is recorded as a `human_verdict` Score on the reviewed Agent Run, likewise
 * invisible from other workspaces.
 *
 * Every run is driven through the platform with MOCK_AGENT=true. The mock
 * agent's result is `{ mock, summary }` and it records two trajectory entries
 * per attempt, which is what these assertions lean on. The reshape call goes to
 * the mock OpenRouter, which answers an unscripted request with prose.
 */

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

test.describe('Step Evaluation foundations — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('a result that breaks agent.outputSchema and cannot be reshaped escalates, saying why', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-output-schema-${Date.now()}`, {
      autonomyLevel: 'L4',
      agent: {
        prompt: 'Grade each adverse event by CTCAE.',
        outputSchema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array' } } },
      },
    }));

    const agentRun = await awaitFinishedAgentRun(request, runId);
    expect(agentRun.status).toBe('escalated');
    expect(agentRun.fallbackReason).toBe('output_schema');

    const eventsRes = await request.get(`/api/processes/${runId}/agent-events?stepId=grade-aes`, { headers: AUTH_HEADERS });
    expect(eventsRes.status()).toBe(200);
    const { events } = (await eventsRes.json()) as { events: Array<{ type: string; payload: unknown }> };
    // The agent ran once; the reshape is an LLM call, not a second attempt.
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    expect(events.some((event) =>
      event.type === 'status' && String(event.payload).includes('missing required keys: findings'),
    )).toBe(true);

    const entries = await getTrajectory(request, agentRun.id);
    expect(entries.map((entry) => entry.seq)).toEqual([0, 1]);

    const run = await pollUntil(
      async () => {
        const res = await request.get(`/api/processes/${runId}`, { headers: AUTH_HEADERS });
        const body = (await res.json()) as { status: string; pauseReason: string | null; error: string | null };
        return body.status === 'paused' && body.error !== null ? body : null;
      },
      { description: `run ${runId} to pause with its reason` },
    );
    expect(run.pauseReason).toBe('agent_escalated');
    expect(run.error).toBe(
      "Agent step 'grade-aes' escalated: result does not match agent.outputSchema: missing required keys: findings "
      + '(reshaping it did not fix it: the answer was not a JSON object)',
    );
  });

  test('a result that breaks agent.outputSchema is reshaped from what it says and the run goes on', async ({ request }) => {
    const overviewKey = `overview_${Date.now()}`;
    const original = { mock: true, summary: 'Mock output for step grade-aes' };
    await scriptOpenRouter(overviewKey, [{ content: JSON.stringify({ [overviewKey]: original.summary }) }]);
    const runId = await startRun(request, agentStepWorkflow(`e2e-output-reshape-${Date.now()}`, {
      autonomyLevel: 'L4',
      agent: {
        prompt: 'Grade each adverse event by CTCAE.',
        outputSchema: { type: 'object', required: [overviewKey], properties: { [overviewKey]: { type: 'string' } } },
      },
    }));

    const agentRun = await awaitFinishedAgentRun(request, runId);

    expect(agentRun).toMatchObject({ status: 'completed', fallbackReason: null });
    expect(agentRun.envelope?.result).toEqual({ [overviewKey]: original.summary });
    expect(agentRun.envelope?.annotations.some((annotation) =>
      annotation.content.includes('reshaped') && annotation.content.includes(JSON.stringify(original)))).toBe(true);
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

  test('a re-run reads the reviewer\'s comment, and a later round\'s case holds the input production first sent', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-revise-rounds-${Date.now()}`, {
      autonomyLevel: 'L3',
      allowedRoles: ['operator'],
    }));
    const reviseRound = async (round: number, comment: string) => {
      const task = await pollUntil(
        async () => {
          const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: AUTH_HEADERS });
          if (res.status() !== 200) return null;
          const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string }> };
          return tasks.find((candidate) => candidate.stepId === 'grade-aes' && candidate.status !== 'completed') ?? null;
        },
        { description: `CM3 review task of round ${round} in ${runId}` },
      );
      const agentRuns = await pollUntil(
        async () => {
          const runs = await listAgentRuns(request, runId);
          return runs !== null && runs.length === round ? runs : null;
        },
        { description: `agent run of round ${round} in ${runId}` },
      );
      const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
        headers: JSON_HEADERS,
        data: { kind: 'verdict', verdict: 'revise', comment },
      });
      expect(completeRes.status(), await completeRes.text()).toBe(200);
      return [...agentRuns].sort((left, right) => left.startedAt.localeCompare(right.startedAt))[round - 1]!;
    };
    const runIo = async (agentRunId: string) => {
      const res = await request.get(`/api/evaluation/agent-runs/${agentRunId}/io`, { headers: AUTH_HEADERS });
      expect(res.status(), await res.text()).toBe(200);
      return GetAgentRunIoOutputSchema.parse(await res.json());
    };

    const firstRound = await reviseRound(1, 'Grade the sepsis event again');
    const secondRound = await reviseRound(2, 'Add the CTCAE version');

    const secondIo = await runIo(secondRound.id);
    expect(secondIo.stepInput).toMatchObject({ verdict: 'revise', reviewerComment: 'Grade the sepsis event again' });
    expect(secondIo.caseInput).toEqual((await runIo(firstRound.id)).caseInput);

    const harvestRes = await request.post('/api/evaluation/cases/from-agent-run', {
      headers: JSON_HEADERS,
      data: { agentRunId: secondRound.id },
    });
    expect(harvestRes.status(), await harvestRes.text()).toBe(201);
    const { evalCase } = EvalCaseOutputSchema.parse(await harvestRes.json());
    expect(evalCase).toMatchObject({ source: 'production', expectation: 'negative', comparison: 'agreement', expectedOutput: secondRound.envelope?.result });
    expect(evalCase.agreementInstructions).toContain('Add the CTCAE version');
    expect(JSON.stringify(evalCase.input)).not.toContain('reviewerComment');
  });

  test('a human step that sends a run back hands the agent its comment and params, and labels the run\'s case with them', async ({ request }) => {
    const runId = await startRun(request, {
      name: `e2e-human-send-back-${Date.now()}`,
      title: 'Human send-back',
      steps: [
        { id: 'grade-aes', name: 'Grade adverse events', type: 'creation', executor: 'agent', autonomyLevel: 'L4' },
        {
          id: 'review', name: 'Review', type: 'review', executor: 'human', allowedRoles: ['operator'],
          params: [{ name: 'ctcaeVersion', type: 'string', required: false }],
          verdicts: { send_back: { target: 'grade-aes' }, approve: { target: 'done' } },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'grade-aes', to: 'review' }],
    });
    const task = await pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: AUTH_HEADERS });
        if (res.status() !== 200) return null;
        const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string }> };
        return tasks.find((candidate) => candidate.stepId === 'review' && candidate.status !== 'completed') ?? null;
      },
      { description: `review task in ${runId}` },
    );
    const firstRound = await awaitFinishedAgentRun(request, runId);
    const completeRes = await request.post(`/api/tasks/${task.id}/complete`, {
      headers: JSON_HEADERS,
      data: { kind: 'verdict-with-params', verdict: 'send_back', comment: 'Grade the sepsis event again', paramValues: { ctcaeVersion: 'v5.0' } },
    });
    expect(completeRes.status(), await completeRes.text()).toBe(200);

    const secondRound = await pollUntil(
      async () => {
        const runs = await listAgentRuns(request, runId);
        return runs?.find((run) => run.id !== firstRound.id && run.status !== 'running') ?? null;
      },
      { description: `second agent run in ${runId}` },
    );
    const ioRes = await request.get(`/api/evaluation/agent-runs/${secondRound.id}/io`, { headers: AUTH_HEADERS });
    expect(ioRes.status(), await ioRes.text()).toBe(200);
    expect(GetAgentRunIoOutputSchema.parse(await ioRes.json()).stepInput).toMatchObject({ comment: 'Grade the sepsis event again', ctcaeVersion: 'v5.0' });

    const harvestRes = await request.post('/api/evaluation/cases/from-agent-run', {
      headers: JSON_HEADERS,
      data: { agentRunId: firstRound.id },
    });
    expect(harvestRes.status(), await harvestRes.text()).toBe(201);
    const { evalCase } = EvalCaseOutputSchema.parse(await harvestRes.json());
    expect(evalCase).toMatchObject({ expectation: 'negative', comparison: 'agreement', expectedOutput: firstRound.envelope?.result });
    expect(evalCase.agreementInstructions).toContain('Grade the sepsis event again');
    expect(evalCase.agreementInstructions).toContain('"ctcaeVersion":"v5.0"');
  });

  test('a run sent back with a revise verdict harvests as a negative case compared by meaning on the comment', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-revise-case-${Date.now()}`, {
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
      headers: JSON_HEADERS,
      data: { kind: 'verdict', verdict: 'revise', comment: 'Grade the sepsis event again' },
    });
    expect(completeRes.status(), await completeRes.text()).toBe(200);

    const harvestRes = await request.post('/api/evaluation/cases/from-agent-run', {
      headers: JSON_HEADERS,
      data: { agentRunId: agentRun!.id },
    });
    expect(harvestRes.status(), await harvestRes.text()).toBe(201);
    const { evalCase } = EvalCaseOutputSchema.parse(await harvestRes.json());
    expect(evalCase).toMatchObject({ expectation: 'negative', comparison: 'agreement', expectedOutput: agentRun!.envelope?.result });
    expect(evalCase.expectedOutput).not.toBeNull();
    expect(evalCase.agreementInstructions).toContain('Grade the sepsis event again');
  });

  test('an agent review requires a revise comment unless the step turns the requirement off', async ({ request }) => {
    const openReviewTask = (runId: string) => pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: AUTH_HEADERS });
        if (res.status() !== 200) return null;
        const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string }> };
        return tasks.find((candidate) => candidate.stepId === 'grade-aes' && candidate.status !== 'completed') ?? null;
      },
      { description: `CM3 review task for ${runId}` },
    );
    const reviseWithoutComment = (taskId: string) => request.post(`/api/tasks/${taskId}/complete`, {
      headers: AUTH_HEADERS,
      data: { kind: 'verdict', verdict: 'revise' },
    });

    const defaultRunId = await startRun(request, agentStepWorkflow(`e2e-revise-comment-default-${Date.now()}`, {
      autonomyLevel: 'L3',
      allowedRoles: ['operator'],
    }));
    const defaultTask = await openReviewTask(defaultRunId);
    const rejected = await reviseWithoutComment(defaultTask.id);
    expect(rejected.ok(), await rejected.text()).toBe(false);

    const optionalRunId = await startRun(request, agentStepWorkflow(`e2e-revise-comment-optional-${Date.now()}`, {
      autonomyLevel: 'L3',
      allowedRoles: ['operator'],
      comment: { requiredForVerdicts: [] },
    }));
    const optionalTask = await openReviewTask(optionalRunId);
    const accepted = await reviseWithoutComment(optionalTask.id);
    expect(accepted.status(), await accepted.text()).toBe(200);

    const nextRound = await openReviewTask(optionalRunId);
    expect(nextRound.id).not.toBe(optionalTask.id);
  });

  test('an agent review collects the params of the step: a revise hands them to the re-run, an approve to the next step', async ({ request }) => {
    const runId = await startRun(request, agentStepWorkflow(`e2e-review-params-${Date.now()}`, {
      autonomyLevel: 'L3',
      allowedRoles: ['operator'],
      params: [{ name: 'ctcaeVersion', type: 'string', required: false }],
      comment: { requiredForVerdicts: [] },
    }));
    const openReviewTask = () => pollUntil(
      async () => {
        const res = await request.get(`/api/tasks?instanceId=${runId}`, { headers: AUTH_HEADERS });
        if (res.status() !== 200) return null;
        const { tasks } = (await res.json()) as { tasks: Array<{ id: string; stepId: string; status: string; params?: Array<{ name: string }> }> };
        return tasks.find((candidate) => candidate.stepId === 'grade-aes' && candidate.status !== 'completed') ?? null;
      },
      { description: `CM3 review task for ${runId}` },
    );
    const complete = (taskId: string, verdict: string) => request.post(`/api/tasks/${taskId}/complete`, {
      headers: JSON_HEADERS,
      data: { kind: 'verdict-with-params', verdict, paramValues: { ctcaeVersion: 'v5.0' } },
    });

    const firstTask = await openReviewTask();
    expect(firstTask.params?.map(({ name }) => name)).toEqual(['ctcaeVersion']);
    const revised = await complete(firstTask.id, 'revise');
    expect(revised.status(), await revised.text()).toBe(200);

    const secondTask = await openReviewTask();
    expect(secondTask.id).not.toBe(firstTask.id);
    const agentRuns = await pollUntil(
      async () => {
        const runs = await listAgentRuns(request, runId);
        return runs !== null && runs.length === 2 ? runs : null;
      },
      { description: `second agent run in ${runId}` },
    );
    const [rerun] = [...agentRuns].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const ioRes = await request.get(`/api/evaluation/agent-runs/${rerun!.id}/io`, { headers: AUTH_HEADERS });
    expect(ioRes.status(), await ioRes.text()).toBe(200);
    const { stepInput } = GetAgentRunIoOutputSchema.parse(await ioRes.json());
    expect(stepInput).toMatchObject({ verdict: 'revise', ctcaeVersion: 'v5.0' });
    expect(JSON.stringify(stepInput)).toContain('Values the reviewer set');

    const approved = await complete(secondTask.id, 'approve');
    expect(approved.status(), await approved.text()).toBe(200);
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
      headers: JSON_HEADERS,
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
