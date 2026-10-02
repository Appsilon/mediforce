import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEvalCase } from '../../eval-cases';
import { freezeEvalDataset } from '../../eval-datasets';
import { createEvaluator } from '../../evaluators';
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
    vi.unstubAllGlobals();
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

  it('keeps every counted Evaluator in the feedback — a passing verdict\'s comment, and one that errored', async () => {
    await createEvaluator({
      ...STEP, name: 'grades-present', rule: 'Every AE carries a grade.', severity: 'major', origin: 'user',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Every AE carries a grade.', minConfidence: 0.8 },
    }, scenario.scope);
    let judgeCalls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      judgeCalls += 1;
      return judgeCalls === 1
        ? new Response(JSON.stringify({
          choices: [{ message: { content: '{"rationale": "Every AE is graded.", "passed": true, "confidence": 0.9}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }))
        : new Response('upstream down', { status: 500 });
    }));
    Object.assign(scenario.scope, {
      workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) },
      models: { list: async () => [{ id: 'anthropic/claude-haiku-4.5', pricing: { input: 0.000001, output: 0.000005 } }] },
    });
    const evalRunId = await finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5, challengers: [] }, () => ({ findings: ['graded'] }));
    const run = (await fixture.evaluationRepo.getEvalRun(evalRunId))!;

    const records = await reflectiveDataset(scenario.scope, run, 'champion');

    expect(records).toHaveLength(2);
    expect(records[0]!.Feedback).toContain('ERROR grades-present (major): Every AE carries a grade.');
    expect(records[0]!.Feedback).toMatch(/Evaluator errors: grades-present: /);
    expect(records[1]!.Feedback).toContain('PASS grades-present (major): Every AE carries a grade. — Every AE is graded.');
  });
});
