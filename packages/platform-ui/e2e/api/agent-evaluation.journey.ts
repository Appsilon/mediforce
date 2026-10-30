import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalRunOutputSchema,
  GetStepQualificationOutputSchema,
  GetWorkflowValidationOutputSchema,
  ListAgentValidationsOutputSchema,
  ListAgentVersionsOutputSchema,
  ListEvalRunsOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow } from '../helpers/agent-step-runs';
import { OUTSIDER_NAMESPACE, sessionCookieHeaders, setupMultiNamespaceCallers } from '../helpers/multi-namespace';

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

async function createAgent(request: APIRequestContext, name: string, visibility: 'public' | 'private' = 'private'): Promise<string> {
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
    visibility,
  }, 201) as { agent: { id: string } };
  return agent.id;
}

/** A summary-present Evaluator, one positive case, a 100% pass bar and a saved Dataset: enough to prepare an Eval Run. */
async function seedSuite(request: APIRequestContext, subject: { namespace: string; agentId: string }, triggerPayload: Record<string, unknown>) {
  await post(request, '/api/evaluation/evaluators', {
    ...subject, name: 'summary-present', rule: 'The result carries a summary.',
    check: { kind: 'schema', schema: { required: ['summary'] } },
  }, 201);
  await post(request, '/api/evaluation/cases', {
    ...subject, name: 'Grade 4 neutropenia', expectation: 'positive',
    input: { triggerPayload, previousStepOutputs: {} },
  }, 201);
  await post(request, '/api/evaluation/acceptance-criteria', { ...subject, criteria: { minPassRate: 1 } }, 201);
  await post(request, '/api/evaluation/datasets', subject, 201);
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

    const triggerPayload = { events: [{ term: 'Neutropenia', anc: 0.4 }] };
    await seedSuite(request, subject, triggerPayload);

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
      // The case's trigger payload is the Agent's whole input: no outputs of earlier steps.
      const detail = await getJson(request, `/api/evaluation/runs/${prepared.evalRun.id}/trials/${trial.id}`) as { stepInput: unknown };
      expect(detail.stepInput).toEqual(triggerPayload);
      // Its input/output pair reads through the Agent, not a workflow named after it.
      const io = await getJson(request, `/api/evaluation/agent-runs/${trial.agentRunId}/io`) as { stepInput: unknown };
      expect(io.stepInput).toEqual(triggerPayload);
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

    // The Eval Run outlives its Agent and still shows the configuration it assessed.
    const deleted = await request.delete(`/api/agents/${agentId}`, { headers: AUTH_HEADERS });
    expect(deleted.ok(), await deleted.text()).toBe(true);
    const afterDelete = EvalRunOutputSchema.parse(await getJson(request, `/api/evaluation/runs/${prepared.evalRun.id}`));
    expect(afterDelete.assessedAgentVersion).toMatchObject({ agentId, version: 1, config: { systemPrompt: 'You grade adverse events by CTCAE v5.' } });
  });

  test('a workflow step that runs a validated Agent as it is takes its validation; one that adds a prompt does not', async ({ request }) => {
    test.setTimeout(120_000);
    const { member } = await setupMultiNamespaceCallers();
    const agentId = await createAgent(request, `AE grader ${randomUUID().slice(0, 8)}`);
    const subject = { namespace: TEST_ORG_HANDLE, agentId };
    await seedSuite(request, subject, { events: [{ term: 'Neutropenia', anc: 0.4 }] });
    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', { ...subject, trialsPerCase: 1, budgetUsd: 1 }, 201));
    await post(request, `/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });
    await pollUntil(
      async () => EvalRunOutputSchema.parse(await getJson(request, `/api/evaluation/runs/${prepared.evalRun.id}`)).evalRun.status === 'completed' || null,
      { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 90_000 },
    );
    const signed = await request.post('/api/evaluation/qualification', {
      headers: sessionCookieHeaders(member), data: { evalRunId: prepared.evalRun.id, decision: 'confirmed' },
    });
    expect(signed.status(), await signed.text()).toBe(201);

    const workflowName = `e2e-validated-agent-${agentId.slice(0, 8)}`;
    for (const step of [
      { autonomyLevel: 'L4', agentId, plugin: 'claude-code-agent' },
      { autonomyLevel: 'L4', agentId, plugin: 'claude-code-agent', agent: { prompt: 'Grade each AE.' } },
    ]) {
      const registered = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, { headers: JSON_HEADERS, data: agentStepWorkflow(workflowName, step) });
      expect(registered.status(), await registered.text()).toBe(201);
    }

    const validation = GetWorkflowValidationOutputSchema.parse(
      await getJson(request, `/api/evaluation/workflow-validation?${new URLSearchParams({ namespace: TEST_ORG_HANDLE, workflowName }).toString()}`),
    );
    expect(validation).toMatchObject({
      versions: [
        { definitionVersion: 2, status: 'not_verified' },
        { definitionVersion: 1, status: 'passed', steps: [{ stepId: 'grade-aes', validation: { status: 'passed', evalRunId: prepared.evalRun.id } }] },
      ],
    });
    expect(validation.versions[1]!.steps[0]!.validation).toMatchObject({
      reason: expect.stringContaining('as it was validated'),
      inheritedFromAgent: { agentId, version: 1 },
    });
  });

  test('an MCP binding change is a new version; a moving model alias and a cowork agent are refused', async ({ request }) => {
    const agentId = await createAgent(request, `AE grader ${randomUUID().slice(0, 8)}`);
    const subject = { namespace: TEST_ORG_HANDLE, agentId };

    const entryId = `e2e-agent-eval-${agentId.slice(0, 8)}`;
    await post(request, `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`, { id: entryId, type: 'http', url: 'https://mcp.example.com/mcp' }, 201);
    const bound = await request.put(`/api/agents/${agentId}/mcp-servers/ctcae`, { headers: JSON_HEADERS, data: { type: 'http', catalogId: entryId } });
    expect(bound.ok(), await bound.text()).toBe(true);
    const afterBind = ListAgentVersionsOutputSchema.parse(await getJson(request, `/api/agents/${agentId}/versions`));
    expect(afterBind.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(Object.keys(afterBind.versions[0]!.config.mcpServers)).toEqual(['ctcae']);
    const unbound = await request.delete(`/api/agents/${agentId}/mcp-servers/ctcae`, { headers: AUTH_HEADERS });
    expect(unbound.ok(), await unbound.text()).toBe(true);
    expect(ListAgentVersionsOutputSchema.parse(await getJson(request, `/api/agents/${agentId}/versions`)).current).toBe(3);

    // A Fingerprint must say which model ran, so an alias that moves cannot be evaluated.
    await seedSuite(request, subject, { events: [{ term: 'Neutropenia', anc: 0.4 }] });
    const aliased = await request.put(`/api/agents/${agentId}`, { headers: JSON_HEADERS, data: { foundationModel: '~anthropic/claude-sonnet-latest' } });
    expect(aliased.status(), await aliased.text()).toBe(200);
    const prepared = await request.post('/api/evaluation/runs', { headers: JSON_HEADERS, data: { ...subject, trialsPerCase: 1, budgetUsd: 1 } });
    expect(prepared.status()).toBe(400);
    expect(await prepared.text()).toContain('an alias whose model changes');

    const cowork = await post(request, '/api/agents', {
      name: `AE chat ${randomUUID().slice(0, 8)}`, iconName: 'Bot', description: 'Talks AEs through',
      kind: 'cowork', runtimeId: 'chat', foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: 'You discuss adverse events.', inputDescription: 'A question', outputDescription: 'An answer',
      namespace: TEST_ORG_HANDLE,
    }, 201) as { agent: { id: string } };
    const coworkCase = await request.post('/api/evaluation/cases', {
      headers: JSON_HEADERS,
      data: { namespace: TEST_ORG_HANDLE, agentId: cowork.agent.id, name: 'A question', expectation: 'positive', input: { triggerPayload: {}, previousStepOutputs: {} } },
    });
    expect(coworkCase.status()).toBe(400);
    expect(await coworkCase.text()).toContain('only container agents are evaluated');
  });

  test('refuses what only a workflow step has: production Evaluators, workspace seeds, earlier step outputs, and naming both owners', async ({ request }) => {
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

    const withEarlierSteps = await request.post('/api/evaluation/cases', {
      headers: JSON_HEADERS,
      data: { ...subject, name: 'Earlier steps', expectation: 'positive', input: { triggerPayload: {}, previousStepOutputs: { extract: { events: [] } } } },
    });
    expect(withEarlierSteps.status(), await withEarlierSteps.text()).toBe(400);

    const both = await request.get(
      `/api/evaluation/cases?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}&workflowName=some-workflow&stepId=grade-aes`,
      { headers: AUTH_HEADERS },
    );
    expect(both.status(), await both.text()).toBe(400);
  });

  test('batch-reads every evaluable agent\'s validation status in one call, leaving out a cowork agent (#1553)', async ({ request }) => {
    const suffix = randomUUID().slice(0, 8);
    const evaluableId = await createAgent(request, `AE grader ${suffix}`);
    const cowork = await post(request, '/api/agents', {
      name: `AE chat ${suffix}`, iconName: 'Bot', description: 'Talks AEs through',
      kind: 'cowork', runtimeId: 'chat', foundationModel: 'anthropic/claude-sonnet-4',
      systemPrompt: 'You discuss adverse events.', inputDescription: 'A question', outputDescription: 'An answer',
      namespace: TEST_ORG_HANDLE,
    }, 201) as { agent: { id: string } };

    const batch = ListAgentValidationsOutputSchema.parse(await getJson(request, `/api/evaluation/qualification/agents?namespace=${TEST_ORG_HANDLE}`));
    expect(batch.statuses[evaluableId]).toBe('not_verified');
    expect(batch.statuses).not.toHaveProperty(cowork.agent.id);

    const direct = GetStepQualificationOutputSchema.parse(
      await getJson(request, `/api/evaluation/qualification?namespace=${TEST_ORG_HANDLE}&agentId=${evaluableId}`),
    );
    expect(batch.statuses[evaluableId]).toBe(direct.validation.status);
  });

  test('a public Agent\'s suite is read from any workspace and changed only from its own, and stays with it', async ({ request }) => {
    const { outsider } = await setupMultiNamespaceCallers();
    const agentId = await createAgent(request, `AE grader ${randomUUID().slice(0, 8)}`, 'public');
    const subject = { namespace: TEST_ORG_HANDLE, agentId };
    const input = { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 }] }, previousStepOutputs: {} };
    await post(request, '/api/evaluation/cases', { ...subject, name: 'Grade 4 neutropenia', expectation: 'positive', input }, 201);

    const outsiderHeaders = sessionCookieHeaders(outsider);
    const read = await request.get(`/api/evaluation/cases?namespace=${TEST_ORG_HANDLE}&agentId=${agentId}`, { headers: outsiderHeaders });
    expect(read.status(), await read.text()).toBe(200);
    expect(((await read.json()) as { cases: Array<{ name: string }> }).cases.map((evalCase) => evalCase.name)).toEqual(['Grade 4 neutropenia']);
    const write = await request.post('/api/evaluation/cases', {
      headers: { ...outsiderHeaders, 'Content-Type': 'application/json' },
      data: { ...subject, name: 'Outsider case', expectation: 'positive', input },
    });
    expect(write.status(), await write.text()).toBe(404);

    // Its suite lives in its workspace, so it cannot move to another one.
    const moved = await request.put(`/api/agents/${agentId}`, { headers: JSON_HEADERS, data: { namespace: OUTSIDER_NAMESPACE } });
    expect(moved.status(), await moved.text()).toBe(409);
  });
});
