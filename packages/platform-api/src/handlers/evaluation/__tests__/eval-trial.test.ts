import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { createEvaluator } from '../evaluators';
import { getEvalRun, listEvalRuns, prepareEvalRun } from '../eval-runs';
import { getEvalTrial } from '../eval-trial';
import { STEP, evaluationFixture, type EvaluationFixture } from './fixture';
import { evalScenario, finishEvalRun, type EvalScenario } from './finished-eval-run';

describe('getEvalTrial (ADR-0023)', () => {
  let fixture: EvaluationFixture;
  let scenario: EvalScenario;
  let previousAllowLocal: string | undefined;
  /** Every message list the judge's model was sent. */
  let judgeCalls: unknown[];

  beforeEach(async () => {
    previousAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
    process.env.ALLOW_LOCAL_AGENTS = 'true';
    fixture = await evaluationFixture();
    scenario = await evalScenario(fixture);
    await createEvaluator({
      ...STEP, name: 'grades-justified', rule: 'Every grade follows CTCAE v5.', severity: 'major', origin: 'user',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'Every grade follows CTCAE v5.', minConfidence: 0.7 },
    }, scenario.scope);
    judgeCalls = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      judgeCalls.push(JSON.parse(init.body).messages);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"rationale": "Entry [0] shows the grade.", "passed": true, "confidence": 0.9}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }));
    }));
    Object.assign(scenario.scope, {
      workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) },
      models: { list: async () => [{ id: 'anthropic/claude-haiku-4.5', pricing: { input: 0.000001, output: 0.000005 } }] },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_AGENTS;
    else process.env.ALLOW_LOCAL_AGENTS = previousAllowLocal;
  });

  /** The neutropenia case returns no findings, so the critical schema check fails it; sepsis passes. */
  async function finishedRun(): Promise<string> {
    return finishEvalRun(fixture, scenario, { trialsPerCase: 1, budgetUsd: 5, challengers: [] }, (trial) =>
      trial.caseId === scenario.caseIds['Grade 4 neutropenia'] ? { summary: 'no findings' } : { findings: ['Grade 5 sepsis'] });
  }

  it('shows a trial\'s case, input and output, every Evaluator\'s grade, and exactly what the judge was sent', async () => {
    const evalRunId = await finishedRun();
    const { trials, report } = await getEvalRun({ evalRunId }, scenario.scope);
    const failing = trials.find((trial) => trial.caseId === scenario.caseIds['Grade 4 neutropenia'])!;

    const result = await getEvalTrial({ evalRunId, trialId: failing.id }, scenario.scope);

    expect(result.trial.id).toBe(failing.id);
    expect(result.variant).toMatchObject({ id: 'champion' });
    expect(result.evalCase).toMatchObject({ name: 'Grade 4 neutropenia' });
    expect(result.result).toEqual({ summary: 'no findings' });
    expect(result.evaluators.map(({ evaluator, outcome, score, error }) => [evaluator.name, outcome, score?.confidence ?? null, error])).toEqual([
      ['findings-present', 'fail', null, null],
      ['grades-justified', 'pass', 0.9, null],
    ]);
    const [schemaCheck, judge] = result.evaluators;
    expect(schemaCheck).toMatchObject({ rule: 'The result lists findings.', check: { kind: 'schema' } });
    expect(schemaCheck!.judgePrompt).toBeNull();
    expect(judge!.score?.comment).toBe('Entry [0] shows the grade.');
    // The judge's two trials were scored in an order of their own; one of its calls is this trial's.
    expect(judgeCalls).toContainEqual(judge!.judgePrompt);
    expect(judge!.judgePrompt?.[0]?.content).toContain('Every grade follows CTCAE v5.');

    expect(report.trialResults.find((entry) => entry.trialId === failing.id)).toEqual({
      trialId: failing.id,
      variantId: 'champion',
      caseName: 'Grade 4 neutropenia',
      passed: false,
      evaluators: [
        { evaluatorId: schemaCheck!.evaluator.evaluatorId, outcome: 'fail', comment: schemaCheck!.score?.comment },
        { evaluatorId: judge!.evaluator.evaluatorId, outcome: 'pass', comment: 'Entry [0] shows the grade.' },
      ],
    });
  });

  it('says why an Evaluator could not grade a trial', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'I would rather not say.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }))));
    const evalRunId = await finishedRun();
    const [trial] = (await getEvalRun({ evalRunId }, scenario.scope)).trials;

    const judge = (await getEvalTrial({ evalRunId, trialId: trial!.id }, scenario.scope)).evaluators[1]!;

    expect(judge).toMatchObject({ outcome: 'errored', score: null, error: expect.stringContaining('judge gave no usable verdict') });
    expect(judge.judgePrompt).not.toBeNull();
  });

  it('lists each run with how its champion fared on the Acceptance Criteria, none while it is prepared', async () => {
    const evalRunId = await finishedRun();
    const { evalRun: prepared } = await prepareEvalRun({ ...STEP, challengers: [], trialsPerCase: 1, concurrency: 1, budgetUsd: 5 }, scenario.scope);

    const { evalRuns } = await listEvalRuns(STEP, scenario.scope);

    expect(evalRuns.find((run) => run.id === prepared.id)?.acceptance).toBeNull();
    expect(evalRuns.find((run) => run.id === evalRunId)?.acceptance).toEqual({ status: 'missed', reason: expect.stringContaining('critical missed') });
  });

  it('does not show a trial of another run, or of another workspace', async () => {
    const evalRunId = await finishedRun();
    const [trial] = (await getEvalRun({ evalRunId }, scenario.scope)).trials;
    await expect(getEvalTrial({ evalRunId, trialId: randomUUID() }, scenario.scope)).rejects.toThrow(NotFoundError);
    const outsider = fixture.scope(userCaller('outsider-1', ['pharma-b']));
    await expect(getEvalTrial({ evalRunId, trialId: trial!.id }, outsider)).rejects.toThrow(NotFoundError);
  });
});
