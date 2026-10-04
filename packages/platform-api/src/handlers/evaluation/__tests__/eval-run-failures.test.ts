import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { getEvalRunFailures } from '../eval-run-failures';
import { evaluationFixture, type EvaluationFixture } from './fixture';
import { evalScenario, finishEvalRun, type EvalScenario } from './finished-eval-run';

describe('getEvalRunFailures (ADR-0023 D14)', () => {
  let fixture: EvaluationFixture;
  let scenario: EvalScenario;
  let previousAllowLocal: string | undefined;

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    scenario = await evalScenario(fixture);
  });

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  /** The step fails on neutropenia and grades sepsis. */
  async function runWithOneFailure(): Promise<string> {
    return finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5 }, (trial) => trial.caseId === scenario.caseIds['Grade 4 neutropenia']
      ? { summary: 'no findings' }
      : { findings: ['graded'] });
  }

  it('lists the champion\'s failing trials with their case and the Evaluators that failed', async () => {
    const evalRunId = await runWithOneFailure();

    const result = await getEvalRunFailures({ evalRunId, limit: 50 }, scenario.scope);

    expect(result).toMatchObject({ evalRunId, variantId: 'champion', variantLabel: 'Current step', total: 1 });
    expect(result.failures).toEqual([{
      trialId: expect.any(String),
      trialIndex: 0,
      status: 'scored',
      caseId: scenario.caseIds['Grade 4 neutropenia'],
      caseName: 'Grade 4 neutropenia',
      split: 'dev',
      expectation: 'positive',
      expectedOutput: null,
      agentRunId: expect.any(String),
      error: null,
      evaluators: [expect.objectContaining({
        name: 'findings-present', severity: 'critical', kind: 'schema', counted: true, outcome: 'failed', error: null,
      })],
    }]);
  });

  it('refuses a variant the run does not have', async () => {
    const evalRunId = await runWithOneFailure();
    await expect(getEvalRunFailures({ evalRunId, variantId: 'challenger-9', limit: 50 }, scenario.scope))
      .rejects.toThrow(NotFoundError);
  });

  it('caps the list at the limit and still reports the total', async () => {
    const evalRunId = await finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5 }, () => ({ summary: 'none' }));
    const result = await getEvalRunFailures({ evalRunId, limit: 1 }, scenario.scope);
    expect(result.total).toBe(2);
    expect(result.failures).toHaveLength(1);
  });

  it('does not show an Eval Run of another workspace', async () => {
    const evalRunId = await runWithOneFailure();
    const outsider = fixture.scope(userCaller('outsider-1', ['pharma-b']));
    await expect(getEvalRunFailures({ evalRunId, limit: 50 }, outsider)).rejects.toThrow(NotFoundError);
  });
});
