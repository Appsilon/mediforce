import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryScoreRepository,
  buildAgentRun,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import type { Score } from '@mediforce/platform-core';
import { classifyAndRecordReviewGap, REVIEW_GAP_SCORE_NAME } from '../classify-review-gap';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

const AGENT_RUN_ID = '3d7e0c4a-5b1f-4e2a-8c9d-0a1b2c3d4e5f';

function answeringOpenRouter(content: string) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: 'stop' }],
  })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function verdictScore(overrides: Partial<Score> = {}): Score {
  return {
    id: 'score-1',
    subject: { type: 'agent_run', id: AGENT_RUN_ID },
    name: 'human_verdict',
    value: 0,
    label: 'request_correction',
    comment: 'Missed the signature date',
    source: 'human',
    createdBy: 'u-1',
    metadata: { verdictKey: 'request_correction', intent: 'danger' },
    namespace: 'team-alpha',
    processInstanceId: 'inst-a',
    stepId: 'cra_decision',
    evaluatorId: null,
    supersedes: null,
    createdAt: '2026-09-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('classifyAndRecordReviewGap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function scopeWithRun() {
    const instanceRepo = new InMemoryProcessInstanceRepository();
    const agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    const scoreRepo = new InMemoryScoreRepository();
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    await agentRunRepo.create(buildAgentRun({ id: AGENT_RUN_ID, processInstanceId: 'inst-a', stepId: 'recommend' }));
    const scope = createTestScope({ instanceRepo, agentRunRepo, scoreRepo, auditRepo: new InMemoryAuditRepository(instanceRepo) });
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
    return { scope, scoreRepo };
  }

  it('records a missed review_gap Score when the judge says the output never covered the comment', async () => {
    const { scope, scoreRepo } = await scopeWithRun();
    answeringOpenRouter('{"rationale": "The output never mentions a signature date.", "missed": true}');

    const score = await classifyAndRecordReviewGap({ verdictScore: verdictScore(), namespace: 'team-alpha' }, scope);

    expect(score).toMatchObject({
      subject: { type: 'agent_run', id: AGENT_RUN_ID },
      name: REVIEW_GAP_SCORE_NAME,
      value: 1,
      label: 'missed',
      comment: 'The output never mentions a signature date.',
      source: 'llm_judge',
    });
    expect(await scoreRepo.list({ limit: 10 })).toHaveLength(1);
  });

  it('records a covered review_gap Score when the judge says it is a judgment call', async () => {
    const { scope } = await scopeWithRun();
    answeringOpenRouter('{"rationale": "The output already addresses this; the reviewer just weighs the risk differently.", "missed": false}');

    const score = await classifyAndRecordReviewGap({ verdictScore: verdictScore(), namespace: 'team-alpha' }, scope);

    expect(score).toMatchObject({ value: 0, label: 'covered' });
  });

  it('records nothing for a verdict Score without a comment', async () => {
    const { scope, scoreRepo } = await scopeWithRun();
    const fetchMock = answeringOpenRouter('{"rationale": "n/a", "missed": false}');

    const score = await classifyAndRecordReviewGap({ verdictScore: verdictScore({ comment: null }), namespace: 'team-alpha' }, scope);

    expect(score).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await scoreRepo.list({ limit: 10 })).toEqual([]);
  });

  it('records nothing when the Agent Run has no result to judge against', async () => {
    const instanceRepo = new InMemoryProcessInstanceRepository();
    const agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    const scoreRepo = new InMemoryScoreRepository();
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
    await agentRunRepo.create(buildAgentRun({ id: AGENT_RUN_ID, processInstanceId: 'inst-a', stepId: 'recommend', envelope: null, status: 'error' }));
    const scope = createTestScope({ instanceRepo, agentRunRepo, scoreRepo, auditRepo: new InMemoryAuditRepository(instanceRepo) });
    const fetchMock = answeringOpenRouter('{"rationale": "n/a", "missed": false}');

    const score = await classifyAndRecordReviewGap({ verdictScore: verdictScore(), namespace: 'team-alpha' }, scope);

    expect(score).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await scoreRepo.list({ limit: 10 })).toEqual([]);
  });
});
