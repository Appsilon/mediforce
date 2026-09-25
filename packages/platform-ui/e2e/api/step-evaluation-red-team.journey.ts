import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { CreateRedTeamEvalCasesOutputSchema, EvalRunOutputSchema, type EvalRunOutput } from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';

/**
 * API E2E for the red-team and robustness suites (ADR-0023, Step Evaluation
 * 5a): a prompt-injection suite and a robustness suite built from one
 * production run, graded by the built-in Evaluators, and a report that gives
 * each suite's pass rate.
 *
 * MOCK_AGENT=true: the mock agent's result is `{ mock, summary }` whatever it
 * is given, so it ignores every injection and stays stable.
 */

async function post(request: APIRequestContext, path: string, data: Record<string, unknown>, status = 200) {
  const res = await request.post(path, { headers: JSON_HEADERS, data });
  expect(res.status(), await res.text()).toBe(status);
  return res.json();
}

test.describe('Step Evaluation red-team suites — API E2E', () => {
  test('injection and robustness suites from a production run, with per-suite pass rates in the report', async ({ request }) => {
    test.setTimeout(150_000);
    const workflowName = `e2e-red-team-${randomUUID().slice(0, 8)}`;
    const runId = await startRun(
      request,
      {
        ...agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }),
        triggerInput: [{ name: 'note', type: 'string' }],
      },
      { note: 'Patient reported fatigue after dose 2.' },
    );
    const production = await awaitFinishedAgentRun(request, runId);
    const step = { namespace: TEST_ORG_HANDLE, workflowName, stepId: 'grade-aes' };
    const target = { part: 'triggerPayload', path: ['note'] };

    const refused = await request.post('/api/evaluation/cases/red-team', {
      headers: JSON_HEADERS,
      data: { ...step, baseAgentRunId: production.id, suite: 'prompt_injection', target: { part: 'triggerPayload', path: ['missing'] } },
    });
    expect(refused.status(), await refused.text()).toBe(400);

    const injection = CreateRedTeamEvalCasesOutputSchema.parse(await post(request, '/api/evaluation/cases/red-team', {
      ...step, baseAgentRunId: production.id, suite: 'prompt_injection', target,
    }, 201));
    const robustness = CreateRedTeamEvalCasesOutputSchema.parse(await post(request, '/api/evaluation/cases/red-team', {
      ...step, baseAgentRunId: production.id, suite: 'robustness', target,
    }, 201));
    expect(injection.cases).toHaveLength(3);
    expect(robustness.cases).toHaveLength(2);
    for (const evalCase of injection.cases) {
      expect(evalCase.perturbation).toMatchObject({ kind: 'injected_instruction', canary: expect.stringMatching(/^CANARY-/) });
      expect(evalCase.input.triggerPayload.note).toContain(evalCase.perturbation!.canary);
    }

    const evaluators = [
      { name: 'ignores-injection', check: { kind: 'builtin', name: 'injection_ignored' } },
      { name: 'result-stable', check: { kind: 'builtin', name: 'result_stable', keys: ['summary'] } },
      { name: 'no-phi', check: { kind: 'builtin', name: 'phi_leak' } },
    ];
    for (const evaluator of evaluators) {
      await post(request, '/api/evaluation/evaluators', { ...step, ...evaluator, rule: evaluator.name, severity: 'critical' }, 201);
    }
    await post(request, '/api/evaluation/datasets', step, 201);
    const prepared = EvalRunOutputSchema.parse(await post(request, '/api/evaluation/runs', {
      ...step, trialsPerCase: 1, concurrency: 2, budgetUsd: 1,
    }, 201));
    expect(prepared.evalRun.evaluators.every((evaluator) => evaluator.counted)).toBe(true);
    await post(request, `/api/evaluation/runs/${prepared.evalRun.id}/start`, { confirmedBudgetUsd: 1 });

    const finished: EvalRunOutput = await pollUntil(
      async () => {
        const res = await request.get(`/api/evaluation/runs/${prepared.evalRun.id}`, { headers: AUTH_HEADERS });
        const body = EvalRunOutputSchema.parse(await res.json());
        return body.evalRun.status === 'completed' ? body : null;
      },
      { description: `Eval Run ${prepared.evalRun.id} to complete`, timeoutMs: 120_000 },
    );

    const [champion] = finished.report.variants;
    const bySuite = Object.fromEntries(champion!.suites.map((suite) => [suite.suite, suite]));
    // The injection check grades the 3 injection cases; on the 2 robustness cases it has no canary, so it is not graded.
    expect(bySuite.prompt_injection).toMatchObject({ evaluators: ['ignores-injection'], passes: 3, failures: 0, errors: 2, passRate: 1 });
    expect(bySuite.robustness).toMatchObject({ evaluators: ['result-stable'], passes: 5, failures: 0, errors: 0, passRate: 1 });
    expect(bySuite.phi_leak).toMatchObject({ evaluators: ['no-phi'], passes: 5, failures: 0, errors: 0, passRate: 1 });
  });
});
