import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  EvalOptimisationOutputSchema,
  EvalRunOutputSchema,
  ListOptimisationsOutputSchema,
  type EvalOptimisationOutput,
} from '@mediforce/platform-api/contract';
import { test, expect } from '../helpers/test-fixtures';
import { pollUntil } from '../helpers/poll-until';
import { AUTH_HEADERS, JSON_HEADERS, agentStepWorkflow, awaitFinishedAgentRun, startRun } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { openRouterRequests, scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * API E2E for GEPA optimisation (ADR-0023 D15, Phase 5): from a finished Eval
 * Run, the GEPA job — the real `gepa` package, run as a local process under
 * ALLOW_LOCAL_AGENTS — reflects on the failing dev trial through the mock
 * OpenRouter and proposes prompts; they run as challengers of a new Eval Run
 * over the dev and the holdout case, within the budget the request granted;
 * the optimisation reads back with the step as its baseline and the
 * candidates ranked.
 *
 * MOCK_AGENT=true: the mock agent's result is `{ mock, summary }`, so a check
 * for `findings` fails on every trial.
 */

function gepaInstalled(): boolean {
  try {
    execFileSync('python3', ['-c', 'import gepa']);
    return true;
  } catch {
    return false;
  }
}

test.describe('Step Evaluation GEPA optimisation — API E2E', () => {
  test.skip(gepaInstalled() === false, 'the GEPA job runs on the host\'s python3 here: pip install gepa');

  test('proposes prompts from a finished run and ranks them over dev and holdout', async ({ request }) => {
    test.setTimeout(180_000);
    await seedEvaluationWorkspace();
    const suffix = randomUUID().slice(0, 8);
    const prompt = `Grade each AE (${suffix}).`;
    const workflowName = `e2e-eval-optimise-${suffix}`;
    const production = await awaitFinishedAgentRun(request, await startRun(
      request, agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt } }), {}, EVALUATION_WORKSPACE,
    ));
    const step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };
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
    await post('/api/evaluation/cases/from-agent-run', { agentRunId: production.id, expectation: 'positive', name: 'Held out', split: 'holdout' }, 201);
    await post('/api/evaluation/datasets', step, 201);

    const source = EvalRunOutputSchema.parse(await post('/api/evaluation/runs', { ...step, trialsPerCase: 1, concurrency: 2, budgetUsd: 1 }, 201));
    await post(`/api/evaluation/runs/${source.evalRun.id}/start`, { confirmedBudgetUsd: 1 }, 200);
    await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/runs/${source.evalRun.id}`, { headers: AUTH_HEADERS });
      return EvalRunOutputSchema.parse(await res.json()).evalRun.status === 'completed' ? true : null;
    }, { description: `Eval Run ${source.evalRun.id} to complete`, timeoutMs: 60_000 });

    // The reflection prompt quotes the step's prompt, so the script keys on it.
    const candidates = [`Grade each AE by CTCAE v5 (${suffix}).`, `List findings with a CTCAE grade (${suffix}).`];
    await scriptOpenRouter(prompt, candidates.map((candidate) => ({ content: `New instruction:\n\`\`\`\n${candidate}\n\`\`\`` })));

    // No budget, no optimisation; a budget is the person's grant.
    const unbudgeted = await request.post('/api/evaluation/optimisations', { headers: JSON_HEADERS, data: { ...step, evalRunId: source.evalRun.id } });
    expect(unbudgeted.status(), await unbudgeted.text()).toBe(400);
    const started = EvalOptimisationOutputSchema.parse(await post('/api/evaluation/optimisations', {
      ...step, evalRunId: source.evalRun.id, budgetUsd: 2, candidates: 2,
    }, 201));
    expect(started.optimisation).toMatchObject({ status: 'proposing', budgetUsd: 2, sourceVariantId: 'champion' });

    const done: EvalOptimisationOutput = await pollUntil(async () => {
      const res = await request.get(`/api/evaluation/optimisations/${started.optimisation.id}`, { headers: AUTH_HEADERS });
      const body = EvalOptimisationOutputSchema.parse(await res.json());
      expect(body.optimisation.status, body.optimisation.error ?? '').not.toBe('failed');
      return body.evalRun?.status === 'completed' ? body : null;
    }, { description: `optimisation ${started.optimisation.id} to finish`, timeoutMs: 120_000 });

    // GEPA reflected on the failing dev trial with the Evaluator's verdict.
    const reflections = await openRouterRequests(prompt);
    expect(reflections).toHaveLength(2);
    expect(reflections[0]!.messages[0]!.content).toContain('FAIL findings-present (critical): The result lists findings.');

    expect(done.optimisation.candidates.map((candidate) => candidate.prompt)).toEqual(candidates);
    expect(done.evalRun!.budgetUsd).toBeLessThanOrEqual(2);
    expect(done.baseline).toMatchObject({ variantId: 'champion', dev: { cases: 1, graded: 1, passes: 0 }, holdout: { cases: 1, graded: 1, passes: 0 } });
    expect(done.ranking.map((candidate) => candidate.rank)).toEqual([1, 2]);
    expect(done.ranking.map((candidate) => candidate.prompt).sort()).toEqual([...candidates].sort());
    for (const candidate of done.ranking) {
      expect(candidate).toMatchObject({ dev: { cases: 1, graded: 1 }, holdout: { cases: 1, graded: 1 } });
    }

    const listed = ListOptimisationsOutputSchema.parse(await (await request.get(
      `/api/evaluation/optimisations?namespace=${step.namespace}&workflowName=${workflowName}&stepId=grade-aes`, { headers: AUTH_HEADERS },
    )).json());
    expect(listed.optimisations.map((optimisation) => optimisation.id)).toEqual([started.optimisation.id]);
  });
});
