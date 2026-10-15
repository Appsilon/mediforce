import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalRunOutputSchema,
  GetStepQualificationOutputSchema,
  ListAgentVersionsOutputSchema,
  ListEvalRunsOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS } from '../helpers/agent-step-runs';

/**
 * API E2E for an Agent evaluated on its own (ADR-0029): the Agent owns its
 * Evaluators, Eval Cases, Dataset and Acceptance Criteria; an Eval Run of it
 * runs each trial as a real single-step Workflow Run that no stored Workflow
 * holds, and names the Agent version it assessed with that version's exact
 * configuration. Editing the Agent makes it a new version the run did not
 * assess.
 *
 * MOCK_AGENT=true: `claude-code-agent` is the mock agent, whose result is
 * `{ mock, summary }`.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

async function getJson(request: APIRequestContext, path: string) {
  const res = await request.get(path, { headers: AUTH_HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function createAgent(request: APIRequestContext, name: string): Promise<string> {
  const { agent } = await post(request, '/api/agents', {
    name,
    iconName: 'Bot',
    description: 'Grades adverse events',
    runtimeId: 'claude-code-agent',
    foundationModel: 'anthropic/claude-sonnet-4',
    systemPrompt: 'You grade adverse events by CTCAE v5.',
    inputDescription: 'Extracted AEs',
    outputDescription: 'Graded AEs',
    namespace: TEST_ORG_HANDLE,
  }, 201) as { agent: { id: string } };
  return agent.id;
}

test.describe('Agent Evaluation — API E2E', () => {
  test('an Agent owns a suite; its Eval Run assesses one Agent version and records its configuration', async ({ request }) => {
    test.setTimeout(120_000);
    const agentId = await createAgent(request, `AE grader ${randomUUID().slice(0, 8)}`);
    const subject = { namespace: TEST_ORG_HANDLE, agentId };

    // Saving the Agent recorded its first version.
    const created = ListAgentVersionsOutputSchema.parse(await getJson(request, `/api/agents/${agentId}/versions`));
    expect(created.versions.map((version) => version.version)).toEqual([1]);
    expect(created.current).toBe(1);

    await post(request, '/api/evaluation/evaluators', {
      ...subject, name: 'summary-present', rule: 'The result carries a summary.',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201);
    await post(request, '/api/evaluation/cases', {
      ...subject, name: 'Grade 4 neutropenia', expectation: 'positive',
      input: { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 }] }, previousStepOutputs: {} },
    }, 201);
    await post(request, '/api/evaluation/acceptance-criteria', { ...subject, criteria: { minPassRate: 1 } }, 201);
    await post(request, '/api/evaluation/datasets', subject, 201);

    // The suite is the Agent's own: it lists under the Agent, apart from any Step.
    const cases = await getJson(request, `/api/evaluation/cases?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}`) as { cases: Array<{ agentId: string | null; workflowName: string | null }> };
    expect(cases.cases).toHaveLength(1);
    expect(cases.cases[0]).toMatchObject({ agentId, workflowName: null });

    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', {
      ...subject, trialsPerCase: 2, concurrency: 2, budgetUsd: 1,
    }, 201));
    expect(prepared.evalRun).toMatchObject({ agentId, agentVersion: 1, workflowName: null, stepId: null, definitionVersion: null, status: 'prepared' });
    expect(prepared.assessedAgentVersion).toMatchObject({
      agentId,
      version: 1,
      config: { runtimeId: 'claude-code-agent', foundationModel: 'anthropic/claude-sonnet-4', systemPrompt: 'You grade adverse events by CTCAE v5.' },
    });
    await post(request, `/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });

    const finished: EvalRunOutput = await pollUntil(
      async () => {
        const body = EvalRunOutputSchema.parse(await getJson(request, `/api/evaluation/runs/${prepared.evalRun.id}`));
        return body.evalRun.status === 'completed' ? body : null;
      },
      { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 90_000 },
    );
    expect(finished.trials).toHaveLength(2);
    for (const trial of finished.trials) {
      expect(trial.status, trial.error ?? '').toBe('scored');
      // A real single-step run of the Agent, which no stored Workflow holds.
      const instance = await getJson(request, `/api/processes/${trial.processInstanceId}`) as Record<string, unknown>;
      expect(instance).toMatchObject({ evalRunId: prepared.evalRun.id, status: 'completed', definitionName: `agent:${agentId}`, definitionVersion: '1' });
    }
    expect(finished.report.evaluators[0]).toMatchObject({ name: 'summary-present', passes: 2, failures: 0 });
    expect(finished.evalRun.acceptance?.status).toBe('met');

    const qualification = GetStepQualificationOutputSchema.parse(
      await getJson(request, `/api/evaluation/qualification?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}`),
    );
    expect(qualification).toMatchObject({ agentVersion: 1, definitionVersion: null, validation: { status: 'awaiting_approval', evalRunId: prepared.evalRun.id } });

    // Editing the Agent's behaviour makes it version 2; the run still names version 1 as it was.
    const updated = await request.put(`/api/agents/${agentId}`, {
      headers: JSON_HEADERS, data: { systemPrompt: 'You grade adverse events by CTCAE v6.' },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    const versions = ListAgentVersionsOutputSchema.parse(await getJson(request, `/api/agents/${agentId}/versions`));
    expect(versions.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(versions.current).toBe(2);
    const reread = EvalRunOutputSchema.parse(await getJson(request, `/api/evaluation/runs/${prepared.evalRun.id}`));
    expect(reread.assessedAgentVersion?.config.systemPrompt).toBe('You grade adverse events by CTCAE v5.');
    const afterEdit = GetStepQualificationOutputSchema.parse(
      await getJson(request, `/api/evaluation/qualification?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}`),
    );
    expect(afterEdit).toMatchObject({ agentVersion: 2, validation: { status: 'not_verified' } });

    // A rename is not a new version.
    const renamed = await request.put(`/api/agents/${agentId}`, { headers: JSON_HEADERS, data: { name: `Renamed ${agentId.slice(0, 8)}` } });
    expect(renamed.status(), await renamed.text()).toBe(200);
    expect(ListAgentVersionsOutputSchema.parse(await getJson(request, `/api/agents/${agentId}/versions`)).versions).toHaveLength(2);

    const runs = ListEvalRunsOutputSchema.parse(await getJson(request, `/api/evaluation/runs?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}`));
    expect(runs.evalRuns.map((run) => run.id)).toEqual([prepared.evalRun.id]);
  });

  test('refuses what only a workflow step has: production Evaluators, workspace seeds, and naming both owners', async ({ request }) => {
    const agentId = await createAgent(request, `AE grader ${randomUUID().slice(0, 8)}`);
    const subject = { namespace: TEST_ORG_HANDLE, agentId };

    const production = await request.post('/api/evaluation/evaluators', {
      headers: JSON_HEADERS,
      data: { ...subject, name: 'summary-present', rule: 'A summary.', check: { kind: 'schema', schema: { required: ['summary'] } }, runInProduction: true },
    });
    expect(production.status(), await production.text()).toBe(400);

    const seeded = await request.post('/api/evaluation/cases', {
      headers: JSON_HEADERS,
      data: { ...subject, name: 'Seeded', expectation: 'positive', input: { triggerPayload: {}, previousStepOutputs: {} }, workspaceSeedCommit: 'a1b2c3d4e5f6' },
    });
    expect(seeded.status(), await seeded.text()).toBe(400);

    const both = await request.get(
      `/api/evaluation/cases?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}&workflowName=some-workflow&stepId=grade-aes`,
      { headers: AUTH_HEADERS },
    );
    expect(both.status(), await both.text()).toBe(400);
  });
});
