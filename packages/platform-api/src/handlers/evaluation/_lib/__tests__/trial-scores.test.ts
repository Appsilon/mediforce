import { describe, it, expect } from 'vitest';
import type { EvalRun, EvalTrial, Score } from '@mediforce/platform-core';
import { scoresOfTrial } from '../trial-scores';
import { evaluationFixture, NAMESPACE } from '../../__tests__/fixture';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TRIAL_ID = '22222222-2222-4222-8222-222222222222';
const run = { id: RUN_ID, stepId: 'grade-aes' } as EvalRun;
const trial = { id: TRIAL_ID, processInstanceId: 'inst-1' } as EvalTrial;

function score(id: string, overrides: Partial<Score>): Score {
  return {
    id, subject: { type: 'workflow_run', id: 'inst-1' }, name: 'findings-present', value: 1, label: null, comment: null,
    source: 'deterministic', createdBy: null, metadata: { evalRunId: RUN_ID, trialId: TRIAL_ID },
    namespace: NAMESPACE, processInstanceId: 'inst-1', stepId: 'grade-aes', evaluatorId: null, supersedes: null,
    createdAt: '2026-09-23T08:00:00.000Z', ...overrides,
  };
}

describe('scoresOfTrial', () => {
  it('returns nothing for a trial that never started an instance', async () => {
    const fixture = await evaluationFixture();

    expect(await scoresOfTrial(fixture.scope(), run, { ...trial, processInstanceId: null })).toEqual([]);
  });

  it('keeps only the Evaluator scores stamped with this run and trial', async () => {
    const fixture = await evaluationFixture();
    const mine = score('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {});
    await fixture.scoreRepo.create(mine);
    await fixture.scoreRepo.create(score('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { source: 'human' }));
    await fixture.scoreRepo.create(score('cccccccc-cccc-4ccc-8ccc-cccccccccccc', {
      metadata: { evalRunId: 'other-run', trialId: TRIAL_ID },
    }));
    await fixture.scoreRepo.create(score('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      metadata: { evalRunId: RUN_ID, trialId: 'other-trial' },
    }));

    expect(await scoresOfTrial(fixture.scope(), run, trial)).toEqual([mine]);
  });
});
