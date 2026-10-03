import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EvalRun, EvalTrial, Score } from '@mediforce/platform-core';
import type { CallerScope } from '../../../../repositories/index';
import { recordScore } from '../../../scores/record-score';
import { buildEvalRunReport } from '../eval-run-report';
import { recordJudgeReview } from '../../judge-reviews';
import { evaluationFixture, NAMESPACE, STEP } from '../../__tests__/fixture';

const EVALUATOR = '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const SECOND_EVALUATOR = '6e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE_A = '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE_B = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

function run(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    ...STEP, id: randomUUID(), definitionVersion: 1, datasetVersionId: randomUUID(), caseIds: [CASE_A, CASE_B], exampleCaseIds: [],
    trialsPerCase: 2, concurrency: 2,
    evaluators: [{ evaluatorId: EVALUATOR, name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true }],
    variants: [{ id: 'champion', label: 'Current step', patch: {}, fingerprint: null }],
    acceptanceCriteria: null,
    mcpPolicy: {}, estimate: { perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 },
    budgetUsd: 5, spentUsd: 0, status: 'completed', createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z', startedAt: null, completedAt: null, acceptance: null,
    ...overrides,
  };
}

function trial(evalRunId: string, caseId: string, trialIndex: number, overrides: Partial<EvalTrial> = {}): EvalTrial {
  const variantId = overrides.variantId ?? 'champion';
  return {
    id: randomUUID(), evalRunId, caseId, variantId, trialIndex, status: 'scored', processInstanceId: `trial-${variantId}-${caseId}-${trialIndex}`,
    agentRunId: `agent-${variantId}-${caseId}-${trialIndex}`, costUsd: 0.1, inputTokens: 100, outputTokens: 10, durationMs: 1000,
    confidence: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 0, completedAt: null, mcpReplayMisses: [], erroredJudgeCalls: {}, ...overrides,
  };
}

/** The Evaluator's Score on a trial, as the driver records it. */
async function score(scope: CallerScope, evalRun: EvalRun, scored: EvalTrial, value: number, evaluatorId = EVALUATOR): Promise<void> {
  await recordScore({
    subject: { type: 'agent_run', id: scored.agentRunId! }, name: 'findings-present', value, label: null, comment: null,
    source: 'deterministic', createdBy: null, metadata: { evalRunId: evalRun.id, trialId: scored.id }, namespace: NAMESPACE,
    processInstanceId: scored.processInstanceId, stepId: STEP.stepId, evaluatorId, supersedes: null, basis: 'test',
  }, scope);
}

const JUDGE = { evaluatorId: EVALUATOR, name: 'grades-justified', version: 1, kind: 'llm_judge', severity: 'critical', counted: true } as const;

/** A judge's verdict on a trial, as the driver records it. */
async function judgeScore(scope: CallerScope, evalRun: EvalRun, scored: EvalTrial, passed: boolean, confidence?: number): Promise<Score> {
  return recordScore({
    subject: { type: 'agent_run', id: scored.agentRunId! }, name: JUDGE.name, value: passed ? 1 : 0, label: passed ? 'pass' : 'fail',
    comment: 'The agent graded sepsis 5 after reading the fatal outcome.', source: 'llm_judge', createdBy: null,
    metadata: { evalRunId: evalRun.id, trialId: scored.id, ...(confidence === undefined ? {} : { judgeConfidence: confidence, judgeMinConfidence: 0.8 }) },
    namespace: NAMESPACE, processInstanceId: scored.processInstanceId, stepId: STEP.stepId, evaluatorId: EVALUATOR, supersedes: null, basis: 'test',
  }, scope);
}

describe('buildEvalRunReport', () => {
  it('counts each trial\'s Score for the Evaluator, and a trial with none as an error that still counts toward k', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run();
    // Case A: pass, fail (flaky). Case B: pass, and one trial the check could not grade — so not all k passed.
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1), trial(evalRun.id, CASE_B, 0), trial(evalRun.id, CASE_B, 1, { durationMs: 3000 })];
    for (const [index, value] of [[0, 1], [1, 0], [2, 1]] as const) await score(scope, evalRun, trials[index]!, value);
    // A Score from another Eval Run on the same trial run is not this report's.
    await recordScore({
      subject: { type: 'agent_run', id: 'x' }, name: 'findings-present', value: 1, label: null, comment: null,
      source: 'deterministic', createdBy: null, metadata: { evalRunId: 'another-run', trialId: trials[3]!.id }, namespace: NAMESPACE,
      processInstanceId: trials[3]!.processInstanceId, stepId: STEP.stepId, evaluatorId: EVALUATOR, supersedes: null, basis: 'test',
    }, scope);

    const report = await buildEvalRunReport(scope, evalRun, trials);

    const [champion] = report.variants;
    expect(champion!.evaluators[0]).toMatchObject({
      passes: 2, failures: 1, errors: 1, passRate: 2 / 3,
      passAtK: 1, passHatK: 0, flakiness: 0.5,
    });
    expect(champion).toMatchObject({ id: 'champion', meanDurationMs: 1500, maxDurationMs: 3000, criteria: [], confidence: null });
    expect(report).toMatchObject({
      k: 2,
      trials: { total: 4, scored: 4, failed: 0, skipped: 0, inProgress: 0 },
      inputTokens: 400, outputTokens: 40, comparison: [],
    });
    expect(report.costUsd).toBeCloseTo(0.4, 10);
  });

  it('leaves out of an Evaluator\'s results the trials of cases it does not grade — neither errors nor toward k', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const expectedOutput = { evaluatorId: SECOND_EVALUATOR, name: 'matches-expected', version: 1, kind: 'expected_output', severity: 'critical', counted: true } as const;
    const evalRun = run({ evaluators: [...run().evaluators, expectedOutput] });
    const caseFields = {
      ...STEP, input: { triggerPayload: {}, previousStepOutputs: {} }, workspaceSeedCommit: null, expectation: 'positive', comparison: 'exact',
      agreementInstructions: null, source: 'manual', sourceAgentRunId: null, perturbation: null, origin: 'user', split: 'dev',
      containsProductionData: false, archived: false, createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z',
    } as const;
    // Case A has an expected output and selects only the expected-output check; case B has none, so that check does not grade it.
    await fixture.evaluationRepo.createCase({ ...caseFields, id: CASE_A, name: 'A', expectedOutput: { findings: [] }, evaluatorIds: [SECOND_EVALUATOR] });
    await fixture.evaluationRepo.createCase({ ...caseFields, id: CASE_B, name: 'B', expectedOutput: null, evaluatorIds: null });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1), trial(evalRun.id, CASE_B, 0), trial(evalRun.id, CASE_B, 1, { status: 'failed', agentRunId: null })];
    await score(scope, evalRun, trials[0]!, 1, SECOND_EVALUATOR);
    await score(scope, evalRun, trials[1]!, 0, SECOND_EVALUATOR);
    await score(scope, evalRun, trials[2]!, 1);

    const [champion] = (await buildEvalRunReport(scope, evalRun, trials)).variants;

    expect(champion!.evaluators.map(({ name, passes, failures, errors, passHatK }) => ({ name, passes, failures, errors, passHatK }))).toEqual([
      { name: 'findings-present', passes: 1, failures: 0, errors: 0, passHatK: 0 },
      { name: 'matches-expected', passes: 1, failures: 1, errors: 0, passHatK: 0 },
    ]);
  });

  it('leaves out of the criteria an Evaluator that grades no case of the run, like one that does not count', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const expectedOutput = { evaluatorId: SECOND_EVALUATOR, name: 'matches-expected', version: 1, kind: 'expected_output', severity: 'critical', counted: true } as const;
    const evalRun = run({ trialsPerCase: 1, evaluators: [...run().evaluators, expectedOutput], acceptanceCriteria: { critical: { minPassRate: 1 } } });
    const caseFields = {
      ...STEP, input: { triggerPayload: {}, previousStepOutputs: {} }, workspaceSeedCommit: null, expectation: 'positive', comparison: 'exact',
      agreementInstructions: null, source: 'manual', sourceAgentRunId: null, perturbation: null, origin: 'user', split: 'dev',
      containsProductionData: false, archived: false, createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z', expectedOutput: null, evaluatorIds: null,
    } as const;
    // No case has an expected output yet, so the expected-output check grades nothing.
    await fixture.evaluationRepo.createCase({ ...caseFields, id: CASE_A, name: 'A' });
    await fixture.evaluationRepo.createCase({ ...caseFields, id: CASE_B, name: 'B' });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_B, 0)];
    for (const scored of trials) await score(scope, evalRun, scored, 1);

    const [champion] = (await buildEvalRunReport(scope, evalRun, trials)).variants;

    expect(champion!.criteria[0]).toMatchObject({ status: 'met', evaluators: [{ name: 'findings-present', met: true }] });
  });

  it('counts a failed trial against its case\'s k, but not in the pass rate', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run();
    const passing = trial(evalRun.id, CASE_A, 0);
    const trials = [passing, trial(evalRun.id, CASE_A, 1, { status: 'failed', agentRunId: null, costUsd: null })];
    await score(scope, evalRun, passing, 1);

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.variants[0]!.evaluators[0]).toMatchObject({ passes: 1, failures: 0, errors: 0, passRate: 1, passAtK: 1, passHatK: 0, flakiness: 0 });
    expect(report.trials).toMatchObject({ scored: 1, failed: 1 });
  });

  it('reports each variant on its own trials, judges the frozen criteria, and compares each challenger with the champion', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({
      trialsPerCase: 10,
      caseIds: [CASE_A],
      variants: [
        { id: 'champion', label: 'Current step', patch: {}, fingerprint: null },
        { id: 'challenger-1', label: 'GPT-5', patch: { model: 'openai/gpt-5' }, fingerprint: null },
      ],
      acceptanceCriteria: { critical: { minPassRate: 0.6 } },
    });
    // The champion passes 2 of 10, the challenger all 10: their intervals do not overlap.
    const trials = [
      ...Array.from({ length: 10 }, (_unused, index) => trial(evalRun.id, CASE_A, index, { costUsd: 0.1 })),
      ...Array.from({ length: 10 }, (_unused, index) => trial(evalRun.id, CASE_A, index, { variantId: 'challenger-1', costUsd: 0.3 })),
    ];
    for (const [index, scored] of trials.entries()) await score(scope, evalRun, scored, index < 10 ? Number(index < 2) : 1);

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.variants.map((variant) => [variant.id, variant.trials.scored, variant.evaluators[0]!.passRate])).toEqual([
      ['champion', 10, 0.2], ['challenger-1', 10, 1],
    ]);
    expect(report.variants.map((variant) => variant.criteria[0]!.status)).toEqual(['missed', 'met']);
    expect(report.comparison).toEqual([{
      variantId: 'challenger-1',
      evaluators: [{ evaluatorId: EVALUATOR, name: 'findings-present', championPassRate: 0.2, challengerPassRate: 1, delta: 0.8, verdict: 'better' }],
      meanCostDeltaUsd: expect.closeTo(0.2, 10),
      meanDurationDeltaMs: 0,
    }]);
    expect(report.costUsd).toBeCloseTo(4, 10);
  });

  it('calibrates the agent\'s confidence against whether counted Evaluators passed, and recommends routing', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ trialsPerCase: 20, caseIds: [CASE_A], acceptanceCriteria: { critical: { minPassRate: 0.7 } } });
    // Confident trials all pass; unsure ones mostly fail. The step misses its floor overall, but not where it is confident.
    const trials = Array.from({ length: 20 }, (_unused, index) =>
      trial(evalRun.id, CASE_A, index, { confidence: index < 12 ? 0.95 : 0.4 }));
    for (const [index, scored] of trials.entries()) await score(scope, evalRun, scored, index < 12 || index === 19 ? 1 : 0);

    const [champion] = (await buildEvalRunReport(scope, evalRun, trials)).variants;

    expect(champion!.confidence).toMatchObject({ count: 20, bins: [
      { lower: 0.4, upper: 0.6, count: 8, passRate: 1 / 8 },
      { lower: 0.8, upper: 1, count: 12, passRate: 1 },
    ] });
    expect(champion!.criteria[0]!.status).toBe('missed');
    expect(champion!.recommendation).toMatchObject({ autonomyLevel: 'L4', confidenceThreshold: 0.95, coverage: 0.6 });
  });

  it('calibrates confidence only on trials every counted Evaluator graded: a missing Score is not a pass', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({
      trialsPerCase: 20, caseIds: [CASE_A], acceptanceCriteria: { critical: { minPassRate: 0.5 } },
      evaluators: [
        { evaluatorId: EVALUATOR, name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true },
        { evaluatorId: SECOND_EVALUATOR, name: 'grades-match', version: 1, kind: 'schema', severity: 'critical', counted: true },
      ],
    });
    const trials = Array.from({ length: 20 }, (_unused, index) => trial(evalRun.id, CASE_A, index, { confidence: 0.95 }));
    // The first Evaluator passes every trial; the second errored on the first 12 and passes the rest.
    for (const [index, scored] of trials.entries()) {
      await score(scope, evalRun, scored, 1);
      if (index >= 12) await score(scope, evalRun, scored, 1, SECOND_EVALUATOR);
    }

    const [champion] = (await buildEvalRunReport(scope, evalRun, trials)).variants;

    expect(champion!.confidence).toMatchObject({ count: 8 });
  });

  it('does not judge a criterion met while some trial failed or was skipped', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ status: 'budget_exceeded', acceptanceCriteria: { critical: { minPassRate: 0.1 } } });
    const trials = [
      trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1), trial(evalRun.id, CASE_B, 0),
      trial(evalRun.id, CASE_B, 1, { status: 'skipped', agentRunId: null, costUsd: null, durationMs: null }),
    ];
    for (const scored of trials.slice(0, 3)) await score(scope, evalRun, scored, 1);

    const [champion] = (await buildEvalRunReport(scope, evalRun, trials)).variants;

    expect(champion!.criteria[0]).toMatchObject({ status: 'not_evaluable', reason: '1 of 4 trials failed or were skipped, so the Dataset was not evaluated in full' });
  });

  it('states each MCP server\'s mode, and counts the replayed calls no recording answered', async () => {
    const fixture = await evaluationFixture();
    const evalRun = run({ mcpPolicy: { edc: { mode: 'replay' }, email: { mode: 'deny' } } });
    const miss = { server: 'edc', tool: 'read_record', arguments: { subject: '1001' } };
    const trials = [trial(evalRun.id, CASE_A, 0, { mcpReplayMisses: [miss, miss] }), trial(evalRun.id, CASE_B, 0, { mcpReplayMisses: [miss] })];

    const report = await buildEvalRunReport(fixture.scope(), evalRun, trials);

    expect(report.mcp).toEqual({
      live: [], replayed: ['edc'], denied: ['email'], recordedFirst: [],
      unrecordedCalls: [{ server: 'edc', tool: 'read_record', count: 3 }],
    });
  });

  it('counts the cases a replayed server ran live to record in this run, because none had a recording yet', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ mcpPolicy: { edc: { mode: 'replay' }, meddra: { mode: 'live' } } });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1), trial(evalRun.id, CASE_B, 0)];
    const tape = { tools: [], calls: [] };
    const recording = (server: string, caseId: string, evalRunId: string, trialId: string) => scope.evaluation.appendMcpRecording({
      ...STEP, id: randomUUID(), caseId, server, tape, evalRunId, trialId, recordedAt: '2026-09-23T08:00:00.000Z',
    });
    await recording('edc', CASE_A, evalRun.id, trials[0]!.id);
    await recording('edc', CASE_A, evalRun.id, trials[1]!.id);
    await recording('meddra', CASE_B, evalRun.id, trials[2]!.id);
    // Recorded by an earlier Eval Run: this one replayed it.
    await recording('edc', CASE_B, randomUUID(), randomUUID());

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.mcp).toMatchObject({ live: ['meddra'], replayed: ['edc'], recordedFirst: [{ server: 'edc', cases: 1 }] });
  });

  it('recommends nothing for a variant still running', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ acceptanceCriteria: { critical: { minPassRate: 0.5 } } });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1, { status: 'running' })];
    await score(scope, evalRun, trials[0]!, 1);

    expect((await buildEvalRunReport(scope, evalRun, trials)).variants[0]!.recommendation).toBeNull();
  });

  it('leaves a judge verdict below its minimum confidence out of the criteria, unless a person accepted it', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ trialsPerCase: 3, caseIds: [CASE_A], evaluators: [JUDGE], acceptanceCriteria: { critical: { minPassRate: 1 } } });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1), trial(evalRun.id, CASE_A, 2)];
    await judgeScore(scope, evalRun, trials[0]!, true, 0.9);
    await judgeScore(scope, evalRun, trials[1]!, false, 0.6);
    const accepted = await judgeScore(scope, evalRun, trials[2]!, false, 0.5);
    await recordJudgeReview(scope, { run: evalRun, trial: trials[2]!, judgeScore: accepted, decision: 'accepted', comment: null, reviewedBy: 'reviewer-1' });

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.variants[0]!.evaluators[0]).toMatchObject({ passes: 1, failures: 1, excluded: 1, passRate: 0.5 });
    expect(report.variants[0]!.criteria[0]!.status).toBe('missed');
    expect(report.judgeVerdicts.map((verdict) => [verdict.trialId, verdict.passed, verdict.confidence, verdict.review?.decision ?? null, verdict.counts])).toEqual([
      [trials[0]!.id, true, 0.9, null, true],
      [trials[1]!.id, false, 0.6, null, false],
      [trials[2]!.id, false, 0.5, 'accepted', true],
    ]);
    expect(report.judgeVerdicts[0]).toMatchObject({
      variantId: 'champion', caseId: CASE_A, evaluatorId: EVALUATOR, name: 'grades-justified', severity: 'critical',
      minConfidence: 0.8, rationale: 'The agent graded sepsis 5 after reading the fatal outcome.',
    });
  });

  it('never counts a denied verdict, however confident — and a later review replaces an earlier one', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ trialsPerCase: 2, caseIds: [CASE_A], evaluators: [JUDGE], acceptanceCriteria: { critical: { minPassRate: 1 } } });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1)];
    await judgeScore(scope, evalRun, trials[0]!, true, 0.9);
    const denied = await judgeScore(scope, evalRun, trials[1]!, false, 0.95);
    const review = { run: evalRun, trial: trials[1]!, judgeScore: denied, comment: null, reviewedBy: 'reviewer-1' } as const;
    await recordJudgeReview(scope, { ...review, decision: 'accepted' });
    await recordJudgeReview(scope, { ...review, decision: 'denied', comment: 'The fatal outcome is in the source; the judge misread it.' });

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.variants[0]!.evaluators[0]).toMatchObject({ passes: 1, failures: 0, excluded: 1, passRate: 1 });
    expect(report.variants[0]!.criteria[0]!.status).toBe('met');
    expect(report.judgeVerdicts[1]).toMatchObject({
      counts: false,
      review: { decision: 'denied', reviewedBy: 'reviewer-1', comment: 'The fatal outcome is in the source; the judge misread it.' },
    });
  });

  it('cannot judge a criterion whose judge left every verdict out', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ trialsPerCase: 1, caseIds: [CASE_A], evaluators: [JUDGE], acceptanceCriteria: { critical: { minPassRate: 0.5 } } });
    const trials = [trial(evalRun.id, CASE_A, 0)];
    await judgeScore(scope, evalRun, trials[0]!, true, 0.4);

    const [champion] = (await buildEvalRunReport(scope, evalRun, trials)).variants;

    expect(champion!.criteria[0]).toMatchObject({ status: 'not_evaluable', reason: expect.stringMatching(/1 verdict left out/) });
  });

  it('lists an expected-output agreement score for review, and leaves a denied one out — but not an exact comparison', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const expectedOutput = { ...JUDGE, name: 'matches-expected', kind: 'expected_output' } as const;
    const evalRun = run({ trialsPerCase: 2, caseIds: [CASE_A], evaluators: [expectedOutput], acceptanceCriteria: { critical: { minPassRate: 1 } } });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1)];
    await score(scope, evalRun, trials[0]!, 1);
    const agreement = await recordScore({
      subject: { type: 'agent_run', id: trials[1]!.agentRunId! }, name: expectedOutput.name, value: 1, label: 'pass',
      comment: 'Agreement 0.81 (passes at 0.8). The CTCAE grade differs by one.', source: 'llm_judge', createdBy: null,
      metadata: { evalRunId: evalRun.id, trialId: trials[1]!.id, agreement: 0.81 },
      namespace: NAMESPACE, processInstanceId: trials[1]!.processInstanceId, stepId: STEP.stepId, evaluatorId: EVALUATOR, supersedes: null, basis: 'test',
    }, scope);
    await recordJudgeReview(scope, { run: evalRun, trial: trials[1]!, judgeScore: agreement, decision: 'denied', comment: null, reviewedBy: 'reviewer-1' });

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.variants[0]!.evaluators[0]).toMatchObject({ passes: 1, excluded: 1 });
    expect(report.judgeVerdicts.map((verdict) => [verdict.trialId, verdict.review?.decision ?? null, verdict.counts])).toEqual([
      [trials[1]!.id, 'denied', false],
    ]);
  });

  it('counts a judge verdict recorded before judges reported confidence', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ trialsPerCase: 1, caseIds: [CASE_A], evaluators: [JUDGE] });
    const trials = [trial(evalRun.id, CASE_A, 0)];
    await judgeScore(scope, evalRun, trials[0]!, true);

    const report = await buildEvalRunReport(scope, evalRun, trials);

    expect(report.variants[0]!.evaluators[0]).toMatchObject({ passes: 1, excluded: 0 });
    expect(report.judgeVerdicts[0]).toMatchObject({ confidence: null, minConfidence: null, counts: true });
  });
});
