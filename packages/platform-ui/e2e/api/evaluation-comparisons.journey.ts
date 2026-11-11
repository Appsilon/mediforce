import { randomUUID } from 'node:crypto';
import type { ComparisonOutput, EvalRunOutput, RegisterWorkflowBody } from '@mediforce/platform-api/contract';
import { ApiError, Mediforce } from '@mediforce/platform-api/client';
import { test, expect } from '../helpers/test-fixtures';
import { pollUntil } from '../helpers/poll-until';
import { agentStepWorkflow } from '../helpers/agent-step-runs';
import { EVALUATION_WORKSPACE, seedEvaluationWorkspace } from '../helpers/evaluation-workspace';
import { scriptOpenRouter } from '../helpers/mock-openrouter-server';

/**
 * API E2E for a Comparison (ADR-0024 D4, D5): a baseline and a Variant on the
 * same cases, started with one confirmed budget, and the Variant read against
 * the baseline case by case with an exact sign test.
 *
 * MOCK_AGENT=true: the mock agent's log names the prompt it was given, and the
 * LLM judge reads that log — so a marker in each prompt keys the judge's
 * scripted verdict: every baseline trial fails, every Variant trial passes.
 */

const CASES = 6;

function apiClient(baseURL: string | undefined): Mediforce {
  if (baseURL === undefined) throw new Error('Playwright baseURL is not configured — cannot build an API client');
  return new Mediforce({ apiKey: process.env.PLATFORM_API_KEY ?? 'test-api-key', baseUrl: baseURL });
}

async function expectRefused(promise: Promise<unknown>, status: number, message: RegExp): Promise<void> {
  const error = await promise.then(() => null, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
  expect((error as ApiError).message).toMatch(message);
}

test.describe('Comparisons — API E2E', () => {
  test.beforeAll(async () => {
    await seedEvaluationWorkspace();
  });

  test('a Variant that passes the cases the baseline fails is called better, on a reused baseline that spends nothing', async ({ baseURL }) => {
    test.setTimeout(240_000);
    const mediforce = apiClient(baseURL);
    const suffix = randomUUID().slice(0, 8);
    const baselineKey = `baseline-${suffix}`;
    const variantKey = `variant-${suffix}`;
    const workflowName = `e2e-eval-comparison-${suffix}`;
    await mediforce.workflows.register(
      agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: `Grade each AE (${baselineKey}).` } }) as RegisterWorkflowBody,
      { namespace: EVALUATION_WORKSPACE },
    );
    const step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };

    await mediforce.evaluation.createEvaluator({
      ...step, name: 'grade-correct', rule: 'Every AE is graded by CTCAE v5.',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Is every AE graded by CTCAE v5?' },
    });
    for (let index = 0; index < CASES; index += 1) {
      await mediforce.evaluation.createCase({
        ...step, name: `AE set ${index}`, expectation: 'positive',
        input: { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 + index / 10 }] }, previousStepOutputs: {} },
      });
    }
    await mediforce.evaluation.saveDataset(step);
    const verdict = (passed: boolean) => ({ content: JSON.stringify({ rationale: passed ? 'Graded by CTCAE v5.' : 'No grading criterion cited.', passed, confidence: 0.95 }) });
    await scriptOpenRouter(baselineKey, Array.from({ length: CASES * 2 }, () => verdict(false)));
    await scriptOpenRouter(variantKey, Array.from({ length: CASES * 2 }, () => verdict(true)));

    const baselinePrepared = await mediforce.evaluation.prepareRun({ ...step, trialsPerCase: 1, concurrency: 3, budgetUsd: 1 });
    await mediforce.evaluation.startRun({ evalRunId: baselinePrepared.evalRun.id, confirmedBudgetUsd: 1 });
    const baselineRun: EvalRunOutput = await pollUntil(async () => {
      const run = await mediforce.evaluation.getRun({ evalRunId: baselinePrepared.evalRun.id });
      return run.evalRun.status === 'completed' ? run : null;
    }, { description: 'the baseline Eval Run to complete', timeoutMs: 90_000 });
    expect(baselineRun.report.evaluators[0]).toMatchObject({ passes: 0, failures: CASES });

    const variant = { prompt: `Grade each AE by CTCAE v5, citing the criterion (${variantKey}).` };
    // A named baseline that differs in a frozen input is refused, not silently re-run.
    await expectRefused(
      mediforce.evaluation.prepareComparison({ ...step, variants: [variant], baselineEvalRunId: baselineRun.evalRun.id, trialsPerCase: 2, budgetUsdPerRun: 1 }),
      400, /trials per case/,
    );

    const prepared = await mediforce.evaluation.prepareComparison({ ...step, variants: [variant], trialsPerCase: 1, concurrency: 3, budgetUsdPerRun: 1 });
    // The finished run matches every frozen input, so it is the baseline and the budget covers the Variant only.
    expect(prepared.comparison).toMatchObject({ status: 'prepared', baselineEvalRunId: baselineRun.evalRun.id, baselineReused: true, budgetUsd: 1 });
    expect(prepared.variants).toHaveLength(1);
    expect(prepared.variants[0]!.evalRun).toMatchObject({ variant, comparisonId: prepared.comparison.id, status: 'prepared' });
    const comparisonId = prepared.comparison.id;

    // Starting needs a person to confirm the budget they were shown.
    await expectRefused(mediforce.evaluation.startComparison({ comparisonId }), 400, /confirm/);
    await expectRefused(mediforce.evaluation.startComparison({ comparisonId, confirmedBudgetUsd: 0.5 }), 400, /confirm/);
    await mediforce.evaluation.startComparison({ comparisonId, confirmedBudgetUsd: 1 });

    const finished: ComparisonOutput = await pollUntil(async () => {
      const comparison = await mediforce.evaluation.getComparison({ comparisonId });
      return comparison.comparison.status === 'completed' ? comparison : null;
    }, { description: `Comparison ${comparisonId} to complete`, timeoutMs: 120_000 });

    const [variantRun] = finished.variants;
    expect(variantRun!.evaluators[0]).toMatchObject({ name: 'grade-correct', passRate: 1 });
    expect(finished.baseline.evaluators[0]).toMatchObject({ name: 'grade-correct', passRate: 0 });
    expect(variantRun!.calls).toEqual([
      expect.objectContaining({ scope: 'all', wins: CASES, losses: 0, ties: 0, call: 'better' }),
    ]);
    expect(variantRun!.calls[0]!.pValue).toBeLessThan(0.05);
    expect(variantRun!.recommendationScope).toBe('all');
    // The reused baseline ran nothing more.
    expect(finished.baseline.evalRun.spentUsd).toBe(baselineRun.evalRun.spentUsd);
    expect(finished.baseline.evalRun.comparisonId).toBeNull();

    const listed = await mediforce.evaluation.listComparisons(step);
    expect(listed.comparisons.map((comparison) => comparison.id)).toContain(comparisonId);
    // The Variant's run is read under its Comparison, not in the step's runs list.
    const runs = await mediforce.evaluation.listRuns(step);
    expect(runs.evalRuns.map((run) => run.id)).toEqual([baselineRun.evalRun.id]);
  });

  test('a Comparison with no matching baseline prepares its own, and cancelling it stops every run it prepared', async ({ baseURL }) => {
    test.setTimeout(120_000);
    const mediforce = apiClient(baseURL);
    const suffix = randomUUID().slice(0, 8);
    const workflowName = `e2e-eval-comparison-cancel-${suffix}`;
    await mediforce.workflows.register(
      agentStepWorkflow(workflowName, { autonomyLevel: 'L4', agent: { prompt: 'Grade each AE.' } }) as RegisterWorkflowBody,
      { namespace: EVALUATION_WORKSPACE },
    );
    const step = { namespace: EVALUATION_WORKSPACE, workflowName, stepId: 'grade-aes' };
    await mediforce.evaluation.createEvaluator({
      ...step, name: 'summary-present', rule: 'The result carries a summary.',
      check: { kind: 'schema', schema: { required: ['summary'] } },
    });
    await mediforce.evaluation.createCase({
      ...step, name: 'Grade 4 neutropenia', expectation: 'positive',
      input: { triggerPayload: { events: [{ term: 'Neutropenia', anc: 0.4 }] }, previousStepOutputs: {} },
    });
    await mediforce.evaluation.saveDataset(step);

    await expectRefused(
      mediforce.evaluation.prepareComparison({ ...step, variants: [{}], trialsPerCase: 1, budgetUsdPerRun: 1 }),
      400, /must change the model or the prompt/,
    );
    const prepared = await mediforce.evaluation.prepareComparison({
      ...step, variants: [{ prompt: 'Grade each AE by CTCAE v5.' }, { prompt: '' }], trialsPerCase: 1, budgetUsdPerRun: 1,
    });
    expect(prepared.comparison).toMatchObject({ baselineReused: false, budgetUsd: 3 });
    expect(prepared.baseline.evalRun).toMatchObject({ variant: null, comparisonId: prepared.comparison.id, status: 'prepared' });

    const cancelled = await mediforce.evaluation.cancelComparison({ comparisonId: prepared.comparison.id });
    expect(cancelled.comparison.status).toBe('cancelled');
    expect([cancelled.baseline, ...cancelled.variants].map((run) => run.evalRun.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    await expectRefused(
      mediforce.evaluation.startComparison({ comparisonId: prepared.comparison.id, confirmedBudgetUsd: 3 }),
      409, /cancelled/,
    );
  });
});
