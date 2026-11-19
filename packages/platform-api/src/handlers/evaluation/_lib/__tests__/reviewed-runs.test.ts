import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Score } from '@mediforce/platform-core';
import { evaluationFixture, GRADED_RUN, NAMESPACE, UNGRADED_RUN } from '../../__tests__/fixture';
import { HUMAN_VERDICT_SCORE_NAME } from '../../../scores/record-human-verdict';
import { excludeImported, listReviewedRuns, reviewOutcomeOf, splitSessions, type ReviewedRunCandidate } from '../reviewed-runs';

const AGENT = { kind: 'agent', namespace: NAMESPACE, agentId: 'ae-grader' } as const;

function verdict(agentRunId: string, overrides: Partial<Score> = {}): Score {
  return {
    id: randomUUID(),
    subject: { type: 'agent_run', id: agentRunId },
    name: HUMAN_VERDICT_SCORE_NAME,
    value: 1,
    label: null,
    comment: null,
    source: 'human',
    createdBy: 'reviewer-1',
    metadata: null,
    namespace: NAMESPACE,
    processInstanceId: null,
    stepId: null,
    evaluatorId: null,
    supersedes: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('reviewOutcomeOf', () => {
  it('is null for a run nobody has reviewed yet', async () => {
    const fixture = await evaluationFixture();
    expect(await reviewOutcomeOf(fixture.scope(), GRADED_RUN)).toBeNull();
  });

  it('is approved for a positive verdict', async () => {
    const fixture = await evaluationFixture();
    await fixture.scoreRepo.create(verdict(GRADED_RUN, { value: 1 }));
    expect(await reviewOutcomeOf(fixture.scope(), GRADED_RUN)).toBe('approved');
  });

  it('is sentBack for a revise verdict', async () => {
    const fixture = await evaluationFixture();
    await fixture.scoreRepo.create(verdict(GRADED_RUN, { value: 0, label: 'revise' }));
    expect(await reviewOutcomeOf(fixture.scope(), GRADED_RUN)).toBe('sentBack');
  });

  it('is null for a plain reject — none of this feature\'s business', async () => {
    const fixture = await evaluationFixture();
    await fixture.scoreRepo.create(verdict(GRADED_RUN, { value: 0 }));
    expect(await reviewOutcomeOf(fixture.scope(), GRADED_RUN)).toBeNull();
  });
});

describe('listReviewedRuns', () => {
  it('lists only the subject\'s runs with a reviewed outcome', async () => {
    const fixture = await evaluationFixture();
    await fixture.scoreRepo.create(verdict(GRADED_RUN, { value: 1 }));
    await fixture.scoreRepo.create(verdict(UNGRADED_RUN, { value: 0 })); // plain reject — not reviewed

    const candidates = await listReviewedRuns(fixture.scope(), AGENT, {});

    expect(candidates.map((c) => [c.agentRun.id, c.outcome])).toEqual([[GRADED_RUN, 'approved']]);
  });

  it('filters by outcome', async () => {
    const fixture = await evaluationFixture();
    await fixture.scoreRepo.create(verdict(GRADED_RUN, { value: 1 }));

    expect(await listReviewedRuns(fixture.scope(), AGENT, { outcome: 'sentBack' })).toEqual([]);
    expect(
      (await listReviewedRuns(fixture.scope(), AGENT, { outcome: 'approved' })).map((c) => c.agentRun.id),
    ).toEqual([GRADED_RUN]);
  });
});

describe('excludeImported', () => {
  it('drops a candidate whose run an Eval Case already imported', async () => {
    const fixture = await evaluationFixture();
    const agentRun = (await fixture.agentRunRepo.getById(GRADED_RUN))!;
    const candidates: ReviewedRunCandidate[] = [
      { agentRun, outcome: 'approved', definitionVersion: null, sessionId: GRADED_RUN },
    ];

    expect(await excludeImported(fixture.scope(), AGENT, candidates)).toEqual(candidates);

    await fixture.evaluationRepo.createCase({
      namespace: NAMESPACE,
      workflowName: null,
      stepId: null,
      agentId: 'ae-grader',
      id: randomUUID(),
      name: 'already imported',
      input: { triggerPayload: {}, previousStepOutputs: {} },
      expectedOutput: null,
      evaluatorIds: null,
      workspaceSeedCommit: null,
      expectation: 'positive',
      comparison: 'exact',
      agreementInstructions: null,
      source: 'production',
      sourceAgentRunId: GRADED_RUN,
      perturbation: null,
      origin: 'user',
      split: 'dev',
      containsProductionData: true,
      archived: false,
      createdBy: 'reviewer-1',
      createdAt: '2026-10-05T10:00:00.000Z',
    });

    expect(await excludeImported(fixture.scope(), AGENT, candidates)).toEqual([]);
  });
});

function candidateAt(sessionId: string, outcome: 'approved' | 'sentBack', startedAt: string): ReviewedRunCandidate {
  return {
    agentRun: { id: sessionId, startedAt } as ReviewedRunCandidate['agentRun'],
    outcome,
    definitionVersion: null,
    sessionId,
  };
}

describe('splitSessions', () => {
  it('keeps every session dev when there is only one per outcome', () => {
    const assignment = splitSessions([candidateAt('s1', 'approved', '2026-10-01T00:00:00.000Z')]);
    expect(assignment.get('s1')).toBe('dev');
  });

  it('holds out the newest ~30% of each outcome\'s sessions, at least one', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => candidateAt(`s${i}`, 'approved', `2026-10-0${i + 1}T00:00:00.000Z`));
    const assignment = splitSessions(sessions);
    expect([...assignment.values()].filter((split) => split === 'holdout')).toHaveLength(2);
    // The newest sessions are the ones held out.
    expect(assignment.get('s4')).toBe('holdout');
    expect(assignment.get('s3')).toBe('holdout');
    expect(assignment.get('s0')).toBe('dev');
  });

  it('splits each outcome group independently', () => {
    const assignment = splitSessions([
      candidateAt('approved-1', 'approved', '2026-10-01T00:00:00.000Z'),
      candidateAt('approved-2', 'approved', '2026-10-02T00:00:00.000Z'),
      candidateAt('sent-back-1', 'sentBack', '2026-10-01T00:00:00.000Z'),
    ]);
    expect(assignment.get('approved-2')).toBe('holdout');
    expect(assignment.get('approved-1')).toBe('dev');
    // A single sentBack session stays dev — only one, no holdout to take.
    expect(assignment.get('sent-back-1')).toBe('dev');
  });
});
