import { describe, expect, it, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryScoreRepository } from '@mediforce/platform-core/testing';
import type { Score } from '@mediforce/platform-core';
import { listScores } from '../list-scores';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

function buildScore(overrides: Partial<Score>): Score {
  return {
    id: randomUUID(),
    subject: { type: 'agent_run', id: randomUUID() },
    name: 'human_verdict',
    value: 1,
    label: 'approve',
    comment: null,
    source: 'human',
    createdBy: 'u-1',
    metadata: null,
    namespace: 'team-alpha',
    processInstanceId: 'inst-a',
    stepId: 'grade-aes',
    evaluatorId: null,
    supersedes: null,
    createdAt: '2026-09-23T08:00:00.000Z',
    ...overrides,
  };
}

describe('listScores handler', () => {
  let scoreRepo: InMemoryScoreRepository;

  beforeEach(async () => {
    scoreRepo = new InMemoryScoreRepository();
    await scoreRepo.create(buildScore({ namespace: 'team-alpha', stepId: 'grade-aes' }));
    await scoreRepo.create(buildScore({ namespace: 'team-alpha', stepId: 'extract-ae' }));
    await scoreRepo.create(buildScore({ namespace: 'team-beta', processInstanceId: 'inst-b' }));
  });

  it('shows a member only their workspaces\' Scores', async () => {
    const scope = createTestScope({ scoreRepo, caller: userCaller('u-1', ['team-alpha']) });

    const { scores } = await listScores({}, scope);

    expect(scores.map((score) => score.namespace)).toEqual(['team-alpha', 'team-alpha']);
  });

  it('treats namespace as a filter inside membership, never a grant', async () => {
    const scope = createTestScope({ scoreRepo, caller: userCaller('u-1', ['team-alpha']) });

    expect((await listScores({ namespace: 'team-beta' }, scope)).scores).toEqual([]);
  });

  it('narrows by run and step', async () => {
    const scope = createTestScope({ scoreRepo });

    const { scores } = await listScores({ runId: 'inst-a', stepId: 'extract-ae' }, scope);

    expect(scores).toHaveLength(1);
    expect(scores[0]?.stepId).toBe('extract-ae');
  });
});
