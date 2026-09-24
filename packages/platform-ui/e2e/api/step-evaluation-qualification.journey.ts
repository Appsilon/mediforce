import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  EvalRunOutputSchema,
  GetAcceptanceCriteriaOutputSchema,
  GetAgentTrajectoryOutputSchema,
  GetStepQualificationOutputSchema,
  SignStepQualificationOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE, TEST_USER_PASSWORD } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { sessionCookieHeaders, setupMultiNamespaceCallers, type MultiNamespaceFixture } from '../helpers/multi-namespace';

/**
 * API E2E for Step Evaluation 3 (ADR-0023 D5, D10, D11): Acceptance Criteria
 * set before a run and frozen into it, a challenger run beside the step as it
 * is with its patch applied to its trials, criteria judged per variant, and a
 * Step Qualification a signed-in person signs with their password — refused
 * for an API key, and stale once the step changes.
 *
 * MOCK_AGENT=true: the mock agent's result is `{ mock, summary }` at
 * confidence 1, and its first trajectory entry names the MCP servers the step
 * ran with.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

async function trajectoryText(request: APIRequestContext, agentRunId: string): Promise<string> {
  const res = await request.get(`/api/agent-runs/${agentRunId}/trajectory`, { headers: AUTH_HEADERS });
  expect(res.status(), await res.text()).toBe(200);
  return GetAgentTrajectoryOutputSchema.parse(await res.json()).entries[0]?.text ?? '';
}

test.describe('Step Evaluation qualification — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('criteria frozen into a run with a challenger, a signed qualification, and staleness', async ({ request }) => {
    test.setTimeout(150_000);
    const suffix = randomUUID().slice(0, 8);

    const agentRes = await request.post('/api/agents', {
      headers: JSON_HEADERS,
      data: {
        name: `AE grader ${suffix}`,
        iconName: 'Bot',
        description: 'Grades adverse events',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: 'You grade adverse events by CTCAE v5.',
        inputDescription: 'Extracted AEs',
        outputDescription: 'Graded AEs',
        namespace: TEST_ORG_HANDLE,
        mcpServers: { meddra: { type: 'http', url: 'https://mcp.example.com/meddra' } },
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const { agent } = (await agentRes.json()) as { agent: { id: string } };

    const workflowName = `e2e-eval-qualification-${suffix}`;
    const workflow = agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId: agent.id, agent: { prompt: 'Grade each AE.' } });
    const production = await awaitFinishedAgentRun(request, await startRun(request, workflow));
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
    const query = `namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`;

    await post(request, '/api/evaluation/briefs', { ...step, text: 'Grades AEs for the DSMB; a missed grade 5 is critical.' }, 201);
    await post(request, '/api/evaluation/acceptance-criteria', {
      ...step, criteria: { critical: { minPassRate: 0.1, minPassHatK: 1 }, major: { minPassRate: 0.5 } },
    }, 201);
    const criteriaRes = await request.get(`/api/evaluation/acceptance-criteria?${query}`, { headers: AUTH_HEADERS });
    expect(GetAcceptanceCriteriaOutputSchema.parse(await criteriaRes.json()).criteria).toMatchObject({ version: 1 });

    await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'summary-present', rule: 'The result carries a summary.', severity: 'critical',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201);
    await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'major',
      check: { kind: 'schema', schema: { required: ['findings'] } },
    }, 201);
    await post(request, '/api/evaluation/cases/from-agent-run', { agentRunId: production.id, expectation: 'positive' }, 201);
    await post(request, '/api/evaluation/datasets', step, 201);
    const policyRes = await request.put('/api/evaluation/mcp-policy', { headers: JSON_HEADERS, data: { ...step, servers: { meddra: { mode: 'live' } } } });
    expect(policyRes.status(), await policyRes.text()).toBe(200);

    // A challenger that changes nothing is refused; one that narrows MCP runs beside the step.
    const idle = await request.post('/api/evaluation/runs', {
      headers: JSON_HEADERS, data: { ...step, budgetUsd: 1, challengers: [{ label: 'Same', patch: {} }] },
    });
    expect(idle.status(), await idle.text()).toBe(400);
    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', {
      ...step, trialsPerCase: 1, concurrency: 2, budgetUsd: 1,
      challengers: [{ label: 'Without MedDRA', patch: { mcpRestrictions: { meddra: { disable: true } } } }],
    }, 201));
    expect(prepared.evalRun).toMatchObject({
      acceptanceCriteria: { critical: { minPassRate: 0.1, minPassHatK: 1 }, major: { minPassRate: 0.5 } },
      briefVersion: 1,
    });
    expect(prepared.evalRun.variants.map((variant) => variant.id)).toEqual(['champion', 'challenger-1']);
    expect(prepared.trials).toHaveLength(2);
    await post(request, `/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });

    const finished: EvalRunOutput = await pollUntil(
      async () => {
        const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
        const body = EvalRunOutputSchema.parse(await res.json());
        return body.evalRun.status === 'completed' ? body : null;
      },
      { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 120_000 },
    );

    // Each trial ran its own variant: the challenger's patch took MedDRA away.
    for (const trial of finished.trials) {
      expect(trial).toMatchObject({ status: 'scored', confidence: 1 });
      expect(await trajectoryText(request, trial.agentRunId!)).toContain(
        trial.variantId === 'champion' ? 'with MCP servers: meddra.' : 'with no MCP servers.',
      );
    }
    const [champion, challenger] = finished.report.variants;
    expect(champion!.criteria.map((verdict) => [verdict.severity, verdict.status])).toEqual([['critical', 'met'], ['major', 'missed']]);
    expect(challenger!.criteria.map((verdict) => verdict.status)).toEqual(['met', 'missed']);
    expect(champion!.recommendation).toMatchObject({ autonomyLevel: 'L3' });
    expect(finished.report.comparison).toEqual([expect.objectContaining({
      variantId: 'challenger-1',
      evaluators: expect.arrayContaining([expect.objectContaining({ name: 'summary-present', verdict: 'no_clear_difference' })]),
    })]);

    const unsigned = GetStepQualificationOutputSchema.parse(await (await request.get(`/api/evaluation/qualification?${query}`, { headers: AUTH_HEADERS })).json());
    expect(unsigned).toMatchObject({ status: 'not_qualified', qualification: null });

    const signing = {
      evalRunId: finished.evalRun.id,
      variantId: 'champion',
      deviations: [{ severity: 'major', justification: 'Findings are listed by the downstream step; a reviewer reads every grade.' }],
      password: TEST_USER_PASSWORD,
    };
    const member = sessionCookieHeaders(callers.member);
    const byApiKey = await request.post('/api/evaluation/qualification', { headers: JSON_HEADERS, data: signing });
    expect(byApiKey.status(), await byApiKey.text()).toBe(403);
    const unjustified = await request.post('/api/evaluation/qualification', { headers: member, data: { ...signing, deviations: [] } });
    expect(unjustified.status(), await unjustified.text()).toBe(400);
    const wrongPassword = await request.post('/api/evaluation/qualification', { headers: member, data: { ...signing, password: 'not-the-password' } });
    expect(wrongPassword.status(), await wrongPassword.text()).toBe(403);
    const outsider = await request.post('/api/evaluation/qualification', { headers: sessionCookieHeaders(callers.outsider), data: signing });
    expect(outsider.status(), await outsider.text()).toBe(404);

    const signedRes = await request.post('/api/evaluation/qualification', { headers: member, data: signing });
    expect(signedRes.status(), await signedRes.text()).toBe(201);
    const { qualification } = SignStepQualificationOutputSchema.parse(await signedRes.json());
    expect(qualification).toMatchObject({
      evalRunId: finished.evalRun.id,
      variantId: 'champion',
      briefVersion: 1,
      fingerprint: { hash: champion!.fingerprint!.hash },
      signature: { signerId: callers.member.uid, reauthentication: 'password' },
    });

    const qualified = GetStepQualificationOutputSchema.parse(await (await request.get(`/api/evaluation/qualification?${query}`, { headers: AUTH_HEADERS })).json());
    expect(qualified).toMatchObject({ status: 'qualified', definitionVersion: 1, changed: [] });

    // A new version with another prompt: the step is no longer the one qualified — but a run of v1 still ran it.
    const v2 = await request.post(`/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`, {
      headers: JSON_HEADERS,
      data: agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId: agent.id, agent: { prompt: 'Grade every AE by CTCAE v5.' } }),
    });
    expect(v2.status(), await v2.text()).toBe(201);
    const stale = GetStepQualificationOutputSchema.parse(await (await request.get(`/api/evaluation/qualification?${query}`, { headers: AUTH_HEADERS })).json());
    expect(stale).toMatchObject({ status: 'stale', definitionVersion: 2, changed: ['step'] });
    const ofV1 = GetStepQualificationOutputSchema.parse(await (await request.get(`/api/evaluation/qualification?${query}&definitionVersion=1`, { headers: AUTH_HEADERS })).json());
    expect(ofV1.status).toBe('qualified');
  });
});
