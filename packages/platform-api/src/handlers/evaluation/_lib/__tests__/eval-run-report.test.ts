import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EvalRun, EvalTrial } from '@mediforce/platform-core';
import type { CallerScope } from '../../../../repositories/index';
import { recordScore } from '../../../scores/record-score';
import { buildEvalRunReport } from '../eval-run-report';
import { evaluationFixture, NAMESPACE, STEP } from '../../__tests__/fixture';

const EVALUATOR = '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const SECOND_EVALUATOR = '6e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE_A = '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE_B = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

function run(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    ...STEP, id: randomUUID(), definitionVersion: 1, datasetVersionId: randomUUID(), caseIds: [CASE_A, CASE_B],
    trialsPerCase: 2, concurrency: 2,
    evaluators: [{ evaluatorId: EVALUATOR, name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true }],
    variants: [{ id: 'champion', label: 'Current step', patch: {}, fingerprint: null }],
    acceptanceCriteria: null, briefVersion: null,
    mcpPolicy: {}, estimate: { perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 },
    budgetUsd: 5, spentUsd: 0, status: 'completed', createdBy: 'a', createdAt: '2026-09-23T08:00:00.000Z', startedAt: null, completedAt: null,
    ...overrides,
  };
}

function trial(evalRunId: string, caseId: string, trialIndex: number, overrides: Partial<EvalTrial> = {}): EvalTrial {
  const variantId = overrides.variantId ?? 'champion';
  return {
    id: randomUUID(), evalRunId, caseId, variantId, trialIndex, status: 'scored', processInstanceId: `trial-${variantId}-${caseId}-${trialIndex}`,
    agentRunId: `agent-${variantId}-${caseId}-${trialIndex}`, costUsd: 0.1, inputTokens: 100, outputTokens: 10, durationMs: 1000,
    confidence: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 0, completedAt: null, ...overrides,
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
    const evalRun = run({ trialsPerCase: 20, caseIds: [CASE_A], acceptanceCriteria: { critical: { minPassRate: 0.5 } } });
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

  it('recommends nothing for a variant still running', async () => {
    const fixture = await evaluationFixture();
    const scope = fixture.scope();
    const evalRun = run({ acceptanceCriteria: { critical: { minPassRate: 0.5 } } });
    const trials = [trial(evalRun.id, CASE_A, 0), trial(evalRun.id, CASE_A, 1, { status: 'running' })];
    await score(scope, evalRun, trials[0]!, 1);

    expect((await buildEvalRunReport(scope, evalRun, trials)).variants[0]!.recommendation).toBeNull();
  });
});
