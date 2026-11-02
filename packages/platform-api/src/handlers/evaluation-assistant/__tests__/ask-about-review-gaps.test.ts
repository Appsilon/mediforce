import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { CallerScope } from '../../../repositories/index';
import { recordScore } from '../../scores/record-score';
import { REVIEW_GAP_SCORE_NAME } from '../../scores/classify-review-gap';
import { askAboutReviewGaps } from '../ask-about-review-gaps';
import { evaluationFixture, STEP, GRADED_RUN, type EvaluationFixture } from '../../evaluation/__tests__/fixture';

async function seedReviewGap(scope: CallerScope, overrides: { value: 0 | 1; comment: string; createdAt: string }): Promise<void> {
  await recordScore({
    subject: { type: 'agent_run', id: GRADED_RUN },
    name: REVIEW_GAP_SCORE_NAME,
    value: overrides.value,
    label: overrides.value === 1 ? 'missed' : 'covered',
    comment: overrides.comment,
    source: 'llm_judge',
    createdBy: null,
    metadata: null,
    namespace: STEP.namespace,
    processInstanceId: 'run-graded',
    stepId: STEP.stepId,
    evaluatorId: null,
    supersedes: null,
    basis: 'test fixture',
  }, scope);
  // Scores are stamped with `new Date().toISOString()` by recordScore, so
  // back-date it directly in the repo for tests that need a specific time.
  const [stored] = await scope.scores.list({ namespace: STEP.namespace, stepId: STEP.stepId, name: REVIEW_GAP_SCORE_NAME, limit: 1 });
  Object.assign(stored!, { createdAt: overrides.createdAt });
}

describe('askAboutReviewGaps', () => {
  let fixture: EvaluationFixture;
  let scope: CallerScope;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the Assistant only about misses since `since`, naming each comment', async () => {
    await seedReviewGap(scope, { value: 1, comment: 'Too old to count', createdAt: '2026-09-01T00:00:00.000Z' });
    await seedReviewGap(scope, { value: 0, comment: 'Just a judgment call', createdAt: '2026-09-23T00:00:00.000Z' });
    await seedReviewGap(scope, { value: 1, comment: 'Missed the signature date', createdAt: '2026-09-23T00:00:00.000Z' });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Looking into it.' }, finish_reason: 'stop' }],
    })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await askAboutReviewGaps({ ...STEP, since: '2026-09-22T00:00:00.000Z' }, scope);

    expect(result.missedCount).toBe(1);
    expect(result.assistant).not.toBeNull();
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('Missed the signature date');
    expect(prompt).not.toContain('Too old to count');
    expect(prompt).not.toContain('Just a judgment call');
  });

  it('asks nothing and returns missedCount 0 when there are no new misses', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await askAboutReviewGaps({ ...STEP, since: '2026-09-22T00:00:00.000Z' }, scope);

    expect(result).toEqual({ missedCount: 0, assistant: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an agent-only subject — review_gap Scores carry a stepId, not an agentId', async () => {
    await expect(askAboutReviewGaps(
      { namespace: STEP.namespace, agentId: 'ae-grader', since: '2026-09-22T00:00:00.000Z' },
      scope,
    )).rejects.toThrow(/works on a workflow step/);
  });
});
