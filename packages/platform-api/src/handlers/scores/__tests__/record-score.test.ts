import { describe, expect, it } from 'vitest';
import { InMemoryAuditRepository, InMemoryScoreRepository } from '@mediforce/platform-core/testing';
import { recordScore, type RecordScoreInput } from '../record-score';
import { ForbiddenError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

const input: RecordScoreInput = {
  subject: { type: 'agent_run', id: '3d7e0c4a-5b1f-4e2a-8c9d-0a1b2c3d4e5f' },
  name: 'has_result',
  value: 1,
  label: null,
  comment: null,
  source: 'deterministic',
  createdBy: null,
  metadata: { rule: 'result !== null' },
  namespace: 'team-alpha',
  processInstanceId: null,
  stepId: null,
  evaluatorId: 'evaluator-has-result',
  supersedes: null,
  basis: 'Deterministic check: has result',
};

describe('recordScore', () => {
  it('stores the Score with a fresh id and appends one score.created audit event', async () => {
    const scoreRepo = new InMemoryScoreRepository();
    const auditRepo = new InMemoryAuditRepository();
    const scope = createTestScope({ scoreRepo, auditRepo });

    const score = await recordScore(input, scope);

    expect(await scoreRepo.list({ limit: 10 })).toEqual([score]);
    const events = await auditRepo.getByEntity('score', score.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: 'deterministic:evaluator-has-result',
      actorType: 'system',
      action: 'score.created',
      basis: 'Deterministic check: has result',
      outputSnapshot: { value: 1, label: null, comment: null },
    });
  });

  it('refuses a user writing into a workspace they are not a member of', async () => {
    const scope = createTestScope({
      scoreRepo: new InMemoryScoreRepository(),
      caller: userCaller('u-1', ['team-beta']),
    });

    await expect(recordScore(input, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
