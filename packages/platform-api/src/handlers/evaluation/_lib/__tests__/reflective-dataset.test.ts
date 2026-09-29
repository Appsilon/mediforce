import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEvalCase } from '../../eval-cases';
import { freezeEvalDataset } from '../../eval-datasets';
import { STEP, evaluationFixture, type EvaluationFixture } from '../../__tests__/fixture';
import { evalScenario, finishEvalRun, type EvalScenario } from '../../__tests__/finished-eval-run';
import { reflectiveDataset } from '../reflective-dataset';

describe('reflectiveDataset', () => {
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

  it('gives GEPA the dev trials, failing first, each with its input, output and the counted Evaluators\' verdicts', async () => {
    const evalRunId = await finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5, challengers: [] },
      (trial) => trial.caseId === scenario.caseIds['Grade 4 neutropenia'] ? { summary: 'no findings' } : { findings: ['graded'] });
    const run = (await fixture.evaluationRepo.getEvalRun(evalRunId))!;

    const records = await reflectiveDataset(scenario.scope, run, 'champion');

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      Inputs: expect.stringContaining('Grade 4 neutropenia'),
      'Generated Outputs': expect.stringMatching(/"summary": "no findings"[\s\S]*Tool calls: none/),
      Feedback: expect.stringContaining('FAIL findings-present (critical): The result lists findings.'),
    });
    expect(records[0]!.Feedback).toContain('The output of this case should be accepted.\nNotes on the case: Grade 4 neutropenia must be graded.');
    expect(records[1]!.Feedback).toContain('PASS findings-present (critical)');
    expect(await reflectiveDataset(scenario.scope, run, 'challenger-1')).toEqual([]);
  });

  it('never includes a holdout case', async () => {
    await createEvalCase({
      ...STEP, name: 'Grade 3 anaemia',
      input: { triggerPayload: {}, previousStepOutputs: { 'extract-aes': { events: [{ term: 'Anaemia' }] } } },
      workspaceSeedCommit: null, expectation: 'positive', notes: null, split: 'holdout', containsProductionData: false, origin: 'user',
    }, scenario.scope);
    await freezeEvalDataset(STEP, scenario.scope);
    const evalRunId = await finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5, challengers: [] }, () => ({ summary: 'none' }));
    const run = (await fixture.evaluationRepo.getEvalRun(evalRunId))!;

    const records = await reflectiveDataset(scenario.scope, run, 'champion');

    expect(JSON.stringify(records)).not.toContain('Anaemia');
  });
});
