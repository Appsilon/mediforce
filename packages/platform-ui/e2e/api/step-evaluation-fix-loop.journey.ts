import { randomUUID } from 'node:crypto';
import {
  ApplyStepVariantOutputSchema,
  EvalRunOutputSchema,
  GetEvalRunFailuresOutputSchema,
  GetStepQualificationOutputSchema,
  GetWorkflowOutputSchema,
  type EvalRunOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { sessionCookieHeaders, setupMultiNamespaceCallers, type MultiNamespaceFixture } from '../helpers/multi-namespace';

/**
 * API E2E for the fix loop of Step Evaluation 4 (ADR-0023 D5, D14): the
 * failing trials of an Eval Run are readable, and a challenger that fixes them
 * is applied to the step as a new Workflow Definition version whose step
 * carries its patch and whose Step Fingerprint is the one the challenger was
 * run under — so a qualification of it would carry over. The champion, an
 * empty patch and a caller who cannot see the workflow are refused.
 *
 * MOCK_AGENT=true: the mock agent's result is `{ mock, summary }`, so a check
 * for `findings` fails on every trial.
 */

const FIXED_PROMPT = 'Grade each AE by CTCAE v5. A fatal outcome is grade 5.';

test.describe('Step Evaluation fix loop — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('reads a run\'s failures, then applies its challenger to the step', async ({ request }) => {
    test.setTimeout(150_000);
    const suffix = randomUUID().slice(0, 8);

    const agentRes = await request.post('/api/agents', {
      headers: JSON_HEADERS,
      data: {
        name: `AE grader ${suffix}`, iconName: 'Bot', description: 'Grades adverse events',
        foundationModel: 'anthropic/claude-sonnet-4', systemPrompt: 'You grade adverse events by CTCAE v5.',
        inputDescription: 'Extracted AEs', outputDescription: 'Graded AEs', namespace: TEST_ORG_HANDLE,
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const { agent } = (await agentRes.json()) as { agent: { id: string } };

    const workflowName = `e2e-eval-fix-loop-${suffix}`;
    const workflow = agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agentId: agent.id, agent: { prompt: 'Grade each AE.' } });
    const production = await awaitFinishedAgentRun(request, await startRun(request, workflow));
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
    const query = `namespace=${step.namespace}&workflowName=${step.workflowName}&stepId=${step.stepId}`;

    const post = async (path: string, data: Record<string, unknown>, status: number) => {
      const res = await request.post(path, { headers: JSON_HEADERS, data });
      expect(res.status(), await res.text()).toBe(status);
      return res.json();
    };

    await post('/api/evaluation/evaluators', {
      ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical',
      check: { kind: 'schema', schema: { required: ['findings'] } },
    }, 201);
    await post('/api/evaluation/cases/from-agent-run', { agentRunId: production.id, expectation: 'positive', name: 'Grade 5 sepsis' }, 201);
    await post('/api/evaluation/datasets', step, 201);

    const prepared = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', {
      ...step, trialsPerCase: 1, concurrency: 2, budgetUsd: 1,
      challengers: [{ label: 'CTCAE grade 5', patch: { prompt: FIXED_PROMPT } }],
    }, 201));
    await post(`/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 }, 200);
    const finished: EvalRunOutput = await pollUntil(
      async () => {
        const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
        const body = EvalRunOutputSchema.parse(await res.json());
        return body.evalRun.status === 'completed' ? body : null;
      },
      { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 120_000 },
    );
    const challenger = finished.evalRun.variants.find((variant) => variant.id === 'challenger-1')!;

    // The failing trials, the champion's by default.
    const failuresUrl = `/api/evaluation/runs/${finished.evalRun.id}/failures`;
    const championFailures = GetEvalRunFailuresOutputSchema.parse(await (await request.get(failuresUrl, { headers: AUTH_HEADERS })).json());
    expect(championFailures).toMatchObject({ variantId: 'champion', total: 1 });
    expect(championFailures.failures[0]).toMatchObject({
      caseName: 'Grade 5 sepsis',
      split: 'dev',
      expectation: 'positive',
      status: 'scored',
      evaluators: [{ name: 'findings-present', severity: 'critical', counted: true, outcome: 'failed' }],
    });
    expect(championFailures.failures[0]!.agentRunId).not.toBeNull();
    const challengerFailures = GetEvalRunFailuresOutputSchema.parse(
      await (await request.get(`${failuresUrl}?variantId=challenger-1`, { headers: AUTH_HEADERS })).json(),
    );
    expect(challengerFailures).toMatchObject({ variantId: 'challenger-1', variantLabel: 'CTCAE grade 5', total: 1 });
    const unknownVariant = await request.get(`${failuresUrl}?variantId=challenger-9`, { headers: AUTH_HEADERS });
    expect(unknownVariant.status(), await unknownVariant.text()).toBe(404);
    const outsiderRead = await request.get(failuresUrl, { headers: sessionCookieHeaders(callers.outsider) });
    expect(outsiderRead.status(), await outsiderRead.text()).toBe(404);

    // Refused: the champion, an empty patch, both a run and a patch, and a caller who cannot see the workflow.
    const refuse = async (data: Record<string, unknown>, status: number, headers: Record<string, string> = JSON_HEADERS) => {
      const res = await request.post('/api/evaluation/variants/apply', { headers, data });
      expect(res.status(), await res.text()).toBe(status);
    };
    await refuse({ ...step, evalRunId: finished.evalRun.id, variantId: 'champion' }, 400);
    await refuse({ ...step, patch: {} }, 400);
    await refuse({ ...step, evalRunId: finished.evalRun.id, variantId: 'challenger-1', patch: { prompt: 'x' } }, 400);
    await refuse({ ...step, evalRunId: finished.evalRun.id, variantId: 'challenger-1' }, 404, {
      ...sessionCookieHeaders(callers.outsider), 'Content-Type': 'application/json',
    });

    // Applied: a new version whose step carries the patch, under the Fingerprint the challenger ran with.
    const appliedRes = await request.post('/api/evaluation/variants/apply', {
      headers: JSON_HEADERS, data: { ...step, evalRunId: finished.evalRun.id, variantId: 'challenger-1', setAsDefault: true },
    });
    expect(appliedRes.status(), await appliedRes.text()).toBe(201);
    const applied = ApplyStepVariantOutputSchema.parse(await appliedRes.json());
    expect(applied).toMatchObject({
      definitionVersion: 2,
      runnable: true,
      variant: { evalRunId: finished.evalRun.id, variantId: 'challenger-1', matchesFingerprint: true, changed: [] },
    });
    expect(applied.fingerprint.hash).toBe(challenger.fingerprint!.hash);

    const v2 = GetWorkflowOutputSchema.parse(await (await request.get(
      `/api/workflow-definitions/${encodeURIComponent(workflowName)}?namespace=${TEST_ORG_HANDLE}&version=2`, { headers: AUTH_HEADERS },
    )).json()).definition;
    expect(v2.steps.find((candidate) => candidate.id === 'grade-aes')?.agent?.prompt).toBe(FIXED_PROMPT);
    const v1 = GetWorkflowOutputSchema.parse(await (await request.get(
      `/api/workflow-definitions/${encodeURIComponent(workflowName)}?namespace=${TEST_ORG_HANDLE}&version=1`, { headers: AUTH_HEADERS },
    )).json()).definition;
    expect(v1.steps.find((candidate) => candidate.id === 'grade-aes')?.agent?.prompt).toBe('Grade each AE.');

    // The step the badge reads is now the challenger's.
    const badge = GetStepQualificationOutputSchema.parse(await (await request.get(`/api/evaluation/qualification?${query}`, { headers: AUTH_HEADERS })).json());
    expect(badge).toMatchObject({ definitionVersion: 2 });
    expect(badge.fingerprint.hash).toBe(challenger.fingerprint!.hash);
  });
});
