import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { EvaluatorOutputSchema, ListScoresOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';

/**
 * API E2E for production Evaluators (ADR-0023 D13): a critical `schema`
 * Evaluator marked "also run in production" fails a live run's output, which
 * takes the step's `fallbackBehavior` with reason `production_evaluator`, and
 * scores the run with a Score marked `production`. The flag reports whether
 * it is in effect.
 *
 * MOCK_AGENT=true: the mock agent's result is `{ mock, summary }`, so a
 * schema requiring `findings` fails it and one requiring `summary` passes.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

async function scoresOf(request: APIRequestContext, runId: string) {
  const res = await request.get(`/api/scores?runId=${runId}&stepId=grade-aes`, { headers: AUTH_HEADERS });
  return ListScoresOutputSchema.parse(await res.json()).scores;
}

test.describe('Step Evaluation production Evaluators — API E2E', () => {
  test('a failing critical production Evaluator sends the run to the step fallback and scores it', async ({ request }) => {
    test.setTimeout(120_000);
    const workflowName = `e2e-production-${randomUUID().slice(0, 8)}`;
    const firstRunId = await startRun(request, agentStepWorkflow(workflowName, {
      autonomyLevel: 'L4',
      agent: { prompt: 'Grade each AE.', fallbackBehavior: 'continue_with_flag' },
    }));
    const beforeFlag = await awaitFinishedAgentRun(request, firstRunId);
    expect(beforeFlag).toMatchObject({ status: 'completed', fallbackReason: null });
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };

    const created = EvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical',
      check: { kind: 'schema', schema: { required: ['findings'] } },
    }, 201));
    expect(created.evaluator).toMatchObject({ runInProduction: false, production: { active: false } });

    // Flagged, but not yet in effect: an unflagged Evaluator never gates.
    const toggled = EvaluatorOutputSchema.parse(await post(request, `/api/evaluation/evaluators/${created.evaluator.id}/production`, { runInProduction: true }));
    expect(toggled.evaluator).toMatchObject({ runInProduction: true, production: { active: true } });

    const gatedRunRes = await post(request, '/api/processes', {
      namespace: TEST_ORG_HANDLE, definitionName: workflowName, triggeredBy: 'e2e-test', triggerName: 'Start', payload: {},
    }, 201) as { run: { id: string } };
    const gated = await awaitFinishedAgentRun(request, gatedRunRes.run.id);

    expect(gated).toMatchObject({ status: 'flagged', fallbackReason: 'production_evaluator' });
    const [score] = await scoresOf(request, gatedRunRes.run.id);
    expect(score).toMatchObject({
      name: 'findings-present', value: 0, source: 'deterministic', evaluatorId: created.evaluator.id,
      metadata: { production: true, evaluatorVersion: 1 },
    });
    expect(score?.metadata).not.toHaveProperty('evalRunId');

    // Off again: the same output is not gated.
    const off = EvaluatorOutputSchema.parse(await post(request, `/api/evaluation/evaluators/${created.evaluator.id}/production`, { runInProduction: false }));
    expect(off.evaluator).toMatchObject({ runInProduction: false, production: { active: false } });
    const freeRunRes = await post(request, '/api/processes', {
      namespace: TEST_ORG_HANDLE, definitionName: workflowName, triggeredBy: 'e2e-test', triggerName: 'Start', payload: {},
    }, 201) as { run: { id: string } };
    expect(await awaitFinishedAgentRun(request, freeRunRes.run.id)).toMatchObject({ status: 'completed', fallbackReason: null });
    expect(await scoresOf(request, freeRunRes.run.id)).toEqual([]);
  });

  test('a flagged code Evaluator waits until its source is approved', async ({ request }) => {
    const workflowName = `e2e-production-code-${randomUUID().slice(0, 8)}`;
    await awaitFinishedAgentRun(request, await startRun(request, agentStepWorkflow(workflowName, {
      autonomyLevel: 'L4',
      agent: { prompt: 'Grade each AE.' },
    })));
    const created = EvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators', {
      namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes', name: 'grade-5-flagged',
      rule: 'A fatal AE is graded 5.', severity: 'critical', runInProduction: true,
      check: { kind: 'code', runtime: 'python', source: 'print(1)' },
    }, 201));

    expect(created.evaluator.production.active).toBe(false);
    expect(created.evaluator.production.reason).toContain('in production once it counts');
  });
});
