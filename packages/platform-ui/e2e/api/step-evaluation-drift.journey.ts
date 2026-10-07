import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { EvaluatorOutputSchema, GetStepDriftOutputSchema } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';

/**
 * API E2E for drift alerts: a production Evaluator's Scores of live runs are
 * read back per window from the Score store. The drop itself — which needs
 * outputs that change — is covered by the handler test; the mock agent's
 * result is always `{ mock, summary }`, so a schema requiring `summary` passes.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

test.describe('Step Evaluation drift alerts — API E2E', () => {
  test('reads a production Evaluator\'s Scores of live runs into its windows', async ({ request }) => {
    test.setTimeout(120_000);
    const workflowName = `e2e-drift-${randomUUID().slice(0, 8)}`;
    await awaitFinishedAgentRun(request, await startRun(request, agentStepWorkflow(workflowName, {
      autonomyLevel: 'L4',
      agent: { prompt: 'Grade each AE.' },
    })));
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
    const query = new URLSearchParams({ ...step, window: '2' }).toString();

    const created = EvaluatorOutputSchema.parse(await post(request, '/api/evaluation/evaluators', {
      ...step, name: 'summary-present', rule: 'The result has a summary.', runInProduction: true,
      check: { kind: 'schema', schema: { required: ['summary'] } },
    }, 201));

    for (let run = 0; run < 2; run += 1) {
      const started = await post(request, '/api/processes', {
        namespace: TEST_ORG_HANDLE, definitionName: workflowName, triggeredBy: 'e2e-test', triggerName: 'Start', payload: {},
      }, 201) as { run: { id: string } };
      await awaitFinishedAgentRun(request, started.run.id);
    }

    const res = await request.get(`/api/evaluation/drift?${query}`, { headers: AUTH_HEADERS });
    expect(res.status(), await res.text()).toBe(200);
    const drift = GetStepDriftOutputSchema.parse(await res.json());
    expect(drift).toEqual({
      window: 2,
      threshold: 0.15,
      evaluators: [{
        evaluatorId: created.evaluator.id, name: 'summary-present', evaluatorVersion: 1,
        recentMean: 1, baselineMean: null, recentCount: 2, baselineCount: 0, drifting: false,
      }],
    });

    const refused = await request.get(`/api/evaluation/drift?${query}&threshold=1.5`, { headers: AUTH_HEADERS });
    expect(refused.status()).toBe(400);
  });
});
