import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EvalOptimisation } from '@mediforce/platform-core';
import { createEvalCase } from '../../eval-cases';
import { freezeEvalDataset } from '../../eval-datasets';
import { STEP, evaluationFixture, type EvaluationFixture } from '../../__tests__/fixture';
import { evalScenario, finishEvalRun, type EvalScenario } from '../../__tests__/finished-eval-run';
import { optimisationResults } from '../optimisation-results';

describe('optimisationResults', () => {
  let fixture: EvaluationFixture;
  let scenario: EvalScenario;
  let previousAllowLocal: string | undefined;

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    scenario = await evalScenario(fixture);
    await createEvalCase({
      ...STEP, name: 'Grade 3 anaemia',
      input: { triggerPayload: {}, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Anaemia' }] } } },
      workspaceSeedCommit: null, expectation: 'positive', expectedOutput: null, comparison: 'exact', agreementInstructions: null, evaluatorIds: null, split: 'holdout', containsProductionData: false, origin: 'user',
    }, scenario.scope);
    await freezeEvalDataset(STEP, scenario.scope);
  });

  afterEach(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  it('splits each variant\'s pass rate into dev and holdout and ranks the candidates by holdout, then dev', async () => {
    const neutropenia = scenario.caseIds['Grade 4 neutropenia'];
    const devCaseIds = Object.values(scenario.caseIds);
    // challenger-1 passes one dev case and the holdout; challenger-2 passes both dev cases but not the holdout.
    const evalRunId = await finishEvalRun(fixture, scenario, {
      trialsPerCase: 1, budgetUsd: 5, challengers: [{ label: 'A', patch: { prompt: 'A' } }, { label: 'B', patch: { prompt: 'B' } }],
    }, (trial) => {
      const passes = trial.variantId === 'challenger-2'
        ? devCaseIds.includes(trial.caseId)
        : trial.caseId !== neutropenia;
      return passes ? { findings: ['graded'] } : { summary: 'none' };
    });
    const run = (await fixture.evaluationRepo.getEvalRun(evalRunId))!;
    const optimisation = {
      candidates: [
        { variantId: 'challenger-1', label: 'A', prompt: 'A', reflectedOn: 2 },
        { variantId: 'challenger-2', label: 'B', prompt: 'B', reflectedOn: 2 },
      ],
    } as unknown as EvalOptimisation;

    const { baseline, ranking } = await optimisationResults(scenario.scope, optimisation, run);

    expect(baseline).toMatchObject({ variantId: 'champion', prompt: null, dev: { cases: 2, graded: 2, passes: 1 }, holdout: { cases: 1, graded: 1, passes: 1 } });
    expect(ranking.map(({ rank, variantId, dev, holdout }) => [rank, variantId, dev.passRate, holdout.passRate])).toEqual([
      [1, 'challenger-1', 0.5, 1],
      [2, 'challenger-2', 1, 0],
    ]);
    expect(ranking[0]!.holdout.wilsonLower).toBeGreaterThan(0);
  });
});
