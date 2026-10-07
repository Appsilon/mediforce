import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { getStepDrift } from '../drift';
import { addEvaluatorVersion, createEvaluator } from '../evaluators';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, type EvaluationFixture } from './fixture';

const findingsSchema = { kind: 'schema' as const, schema: { required: ['findings'] } };

describe('getStepDrift', () => {
  let fixture: EvaluationFixture;
  let evaluatorId: string;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    const { evaluator } = await createEvaluator(
      { ...STEP, name: 'findings-present', rule: 'The result lists findings.', check: findingsSchema, origin: 'user', runInProduction: true },
      fixture.scope(),
    );
    evaluatorId = evaluator.id;
  });

  /** Production Scores oldest first, a minute apart. */
  async function score(values: number[], options: { version?: number; production?: boolean } = {}) {
    for (const value of values) {
      const count = (await fixture.scoreRepo.list({ limit: 1000 })).length;
      await fixture.scoreRepo.create({
        id: randomUUID(),
        subject: { type: 'agent_run', id: GRADED_RUN },
        name: 'findings-present',
        value,
        label: null,
        comment: null,
        source: 'deterministic',
        createdBy: null,
        metadata: options.production === false
          ? { evalRunId: 'eval-run-1', evaluatorVersion: options.version ?? 1 }
          : { production: true, evaluatorVersion: options.version ?? 1 },
        namespace: NAMESPACE,
        processInstanceId: 'run-graded',
        stepId: STEP.stepId,
        evaluatorId,
        supersedes: null,
        createdAt: new Date(Date.UTC(2026, 8, 25, 8, count)).toISOString(),
      });
    }
  }

  it('alerts when the rolling mean of production Scores drops by the threshold', async () => {
    await score([1, 1, 1, 1, 0, 1, 0, 0]);

    const drift = await getStepDrift({ ...STEP, window: 4 }, fixture.scope(undefined, { driftSettings: { window: 20, threshold: 0.25 } }));

    expect(drift).toEqual({
      window: 4,
      threshold: 0.25,
      evaluators: [{
        evaluatorId, name: 'findings-present', evaluatorVersion: 1,
        recentMean: 0.25, baselineMean: 1, recentCount: 4, baselineCount: 4, drifting: true,
      }],
    });
  });

  it('uses the deployment settings, and does not judge before two full windows', async () => {
    await score([1, 1, 1, 0, 0, 0]);

    const drift = await getStepDrift(STEP, fixture.scope(undefined, { driftSettings: { window: 3, threshold: 0.5 } }));
    expect(drift.evaluators[0]).toMatchObject({ recentMean: 0, baselineMean: 1, drifting: true });

    const early = await getStepDrift(STEP, fixture.scope());
    expect(early).toMatchObject({ window: 20, threshold: 0.15 });
    expect(early.evaluators[0]).toMatchObject({ recentMean: null, baselineMean: null, recentCount: 6, drifting: false });
  });

  it('counts only production Scores of the latest version', async () => {
    await score([1, 1, 1, 1]);
    await score([0, 0, 0, 0], { production: false });
    await addEvaluatorVersion({ evaluatorId, rule: 'The result lists graded findings.', origin: 'user' }, fixture.scope());
    await score([0, 0], { version: 2 });

    const drift = await getStepDrift({ ...STEP, window: 2, threshold: 0.5 }, fixture.scope());

    expect(drift.evaluators[0]).toMatchObject({ evaluatorVersion: 2, recentMean: 0, baselineMean: null, drifting: false });
  });

  it('fills both windows with the latest version even when older-version Scores land after it', async () => {
    await addEvaluatorVersion({ evaluatorId, rule: 'The result lists graded findings.', origin: 'user' }, fixture.scope());
    await score([1, 1, 0, 0], { version: 2 });
    await score([1, 1, 1, 1], { version: 1 });

    const drift = await getStepDrift({ ...STEP, window: 2, threshold: 0.5 }, fixture.scope());

    expect(drift.evaluators[0]).toMatchObject({ recentMean: 0, baselineMean: 1, drifting: true });
  });

  it('leaves out Evaluators that do not run in production', async () => {
    await createEvaluator(
      { ...STEP, name: 'grade-5-flagged', rule: 'r', check: findingsSchema, origin: 'user' },
      fixture.scope(),
    );

    const drift = await getStepDrift(STEP, fixture.scope());

    expect(drift.evaluators.map((evaluator) => evaluator.name)).toEqual(['findings-present']);
  });

  it('reads as missing to a caller who cannot see the workflow', async () => {
    await expect(getStepDrift(STEP, fixture.scope(userCaller('outsider', ['other-workspace']))))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
