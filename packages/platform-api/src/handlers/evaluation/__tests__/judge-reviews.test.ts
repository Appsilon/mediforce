import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EvalRun, EvalTrial } from '@mediforce/platform-core';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import type { CallerScope } from '../../../repositories/index';
import { recordScore } from '../../scores/record-score';
import { getEvalRun } from '../eval-runs';
import { getEvalRunFailures } from '../eval-run-failures';
import { reviewJudgeVerdict } from '../judge-reviews';
import { evaluationFixture, NAMESPACE, STEP, type EvaluationFixture } from './fixture';

const JUDGE = '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const SCHEMA_CHECK = '6e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CASE = '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

describe('reviewJudgeVerdict', () => {
  let fixture: EvaluationFixture;
  let scope: CallerScope;
  let evalRun: EvalRun;
  let trial: EvalTrial;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    scope = fixture.scope();
    evalRun = {
      ...STEP, id: randomUUID(), definitionVersion: 1, datasetVersionId: randomUUID(), caseIds: [CASE], exampleCaseIds: [],
      trialsPerCase: 1, concurrency: 1,
      evaluators: [
        { evaluatorId: JUDGE, name: 'grades-justified', version: 1, kind: 'llm_judge', severity: 'critical', counted: true },
        { evaluatorId: SCHEMA_CHECK, name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true },
      ],
      variants: [{ id: 'champion', label: 'Current step', patch: {}, fingerprint: null }],
      acceptanceCriteria: { critical: { minPassRate: 1 } },
      mcpPolicy: {}, estimate: { perTrialUsd: null, totalUsd: null, basis: 'unknown', sampleSize: 0 },
      budgetUsd: 5, spentUsd: 0, status: 'completed', createdBy: 'author-1', createdAt: '2026-10-01T08:00:00.000Z', startedAt: null, completedAt: null,
    };
    trial = {
      id: randomUUID(), evalRunId: evalRun.id, caseId: CASE, variantId: 'champion', trialIndex: 0, status: 'scored',
      processInstanceId: 'trial-run', agentRunId: 'trial-agent-run', costUsd: 0.1, inputTokens: 100, outputTokens: 10, durationMs: 1000,
      confidence: null, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 1, completedAt: null, mcpReplayMisses: [],
    };
    await fixture.evaluationRepo.createEvalRun(evalRun, [trial]);
    // A confident fail the person will deny, and a passing schema check.
    for (const [evaluatorId, source, value, metadata] of [
      [JUDGE, 'llm_judge', 0, { judgeConfidence: 0.92, judgeMinConfidence: 0.8 }],
      [SCHEMA_CHECK, 'deterministic', 1, {}],
    ] as const) {
      await recordScore({
        subject: { type: 'agent_run', id: 'trial-agent-run' }, name: 'check', value, label: null,
        comment: 'The grade ignores the fatal outcome.', source, createdBy: null,
        metadata: { evalRunId: evalRun.id, trialId: trial.id, ...metadata }, namespace: NAMESPACE, processInstanceId: 'trial-run',
        stepId: STEP.stepId, evaluatorId, supersedes: null, basis: 'test',
      }, scope);
    }
  });

  it('a denied verdict leaves the judge out of the Acceptance Criteria without reversing it, and is audited', async () => {
    expect((await getEvalRun({ evalRunId: evalRun.id }, scope)).report.variants[0]!.criteria[0]!.status).toBe('missed');
    expect((await getEvalRunFailures({ evalRunId: evalRun.id, limit: 50 }, scope)).total).toBe(1);

    const { score } = await reviewJudgeVerdict({
      evalRunId: evalRun.id, trialId: trial.id, evaluatorId: JUDGE, decision: 'denied',
      comment: 'Source shows the outcome was not fatal.',
    }, scope);

    expect(score).toMatchObject({ source: 'human', createdBy: 'author-1', label: 'denied', evaluatorId: JUDGE });
    const { report } = await getEvalRun({ evalRunId: evalRun.id }, scope);
    expect(report.judgeVerdicts).toEqual([expect.objectContaining({
      passed: false, counts: false,
      review: expect.objectContaining({ decision: 'denied', reviewedBy: 'author-1', comment: 'Source shows the outcome was not fatal.' }),
    })]);
    expect(report.variants[0]!.evaluators.find((evaluator) => evaluator.evaluatorId === JUDGE)).toMatchObject({ passes: 0, failures: 0, excluded: 1 });
    expect(report.variants[0]!.criteria[0]!.status).toBe('not_evaluable');
    expect((await getEvalRunFailures({ evalRunId: evalRun.id, limit: 50 }, scope)).total).toBe(0);
    expect((await fixture.auditRepo.getByEntity('score', score.id)).map((event) => event.action)).toEqual(['score.created']);
  });

  it('only reviews a model\'s verdict the trial has', async () => {
    await expect(reviewJudgeVerdict({ evalRunId: evalRun.id, trialId: trial.id, evaluatorId: SCHEMA_CHECK, decision: 'accepted' }, scope))
      .rejects.toThrow(/not a model's verdict/);
    await expect(reviewJudgeVerdict({ evalRunId: evalRun.id, trialId: randomUUID(), evaluatorId: JUDGE, decision: 'accepted' }, scope))
      .rejects.toThrow(/no trial/);
  });

  it('reviews an expected-output agreement score like a judge verdict', async () => {
    const agreementCheck = randomUUID();
    const withAgreement: EvalRun = {
      ...evalRun, id: randomUUID(),
      evaluators: [{ evaluatorId: agreementCheck, name: 'matches-expected', version: 1, kind: 'expected_output', severity: 'critical', counted: true }],
    };
    const agreementTrial = { ...trial, id: randomUUID(), evalRunId: withAgreement.id };
    await fixture.evaluationRepo.createEvalRun(withAgreement, [agreementTrial]);
    await recordScore({
      subject: { type: 'agent_run', id: 'trial-agent-run' }, name: 'matches-expected', value: 1, label: 'pass',
      comment: 'Agreement 0.81 (passes at 0.8). The CTCAE grade differs by one.', source: 'llm_judge', createdBy: null,
      metadata: { evalRunId: withAgreement.id, trialId: agreementTrial.id, agreement: 0.81 }, namespace: NAMESPACE, processInstanceId: 'trial-run',
      stepId: STEP.stepId, evaluatorId: agreementCheck, supersedes: null, basis: 'test',
    }, scope);

    await reviewJudgeVerdict({ evalRunId: withAgreement.id, trialId: agreementTrial.id, evaluatorId: agreementCheck, decision: 'denied' }, scope);

    const { report } = await getEvalRun({ evalRunId: withAgreement.id }, scope);
    expect(report.judgeVerdicts).toEqual([expect.objectContaining({ name: 'matches-expected', counts: false })]);
    expect(report.variants[0]!.criteria[0]!.status).toBe('not_evaluable');
  });

  it('needs the workflow\'s edit verb, and a named person for an API key', async () => {
    const outsider = fixture.scope(userCaller('outsider', ['another-namespace']));
    await expect(reviewJudgeVerdict({ evalRunId: evalRun.id, trialId: trial.id, evaluatorId: JUDGE, decision: 'accepted' }, outsider))
      .rejects.toThrow();
    const apiKey = fixture.scope({ kind: 'apiKey', isSystemActor: true });
    await expect(reviewJudgeVerdict({ evalRunId: evalRun.id, trialId: trial.id, evaluatorId: JUDGE, decision: 'accepted' }, apiKey))
      .rejects.toThrow(/must pass `uid`/);
  });
});
