import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryAgentRunRepository,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryScoreRepository,
  buildAgentRun,
  buildHumanTask,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import type { HumanTask } from '@mediforce/platform-core';
import { recordHumanVerdictScore } from '../record-human-verdict';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';

const AGENT_RUN_ID = '3d7e0c4a-5b1f-4e2a-8c9d-0a1b2c3d4e5f';

describe('recordHumanVerdictScore', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let agentRunRepo: InMemoryAgentRunRepository;
  let scoreRepo: InMemoryScoreRepository;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    scoreRepo = new InMemoryScoreRepository();
    await instanceRepo.create(buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }));
  });

  function scope() {
    return createTestScope({ instanceRepo, agentRunRepo, scoreRepo, auditRepo: new InMemoryAuditRepository(instanceRepo) });
  }

  function reviewTask(overrides: Partial<HumanTask> = {}): HumanTask {
    return buildHumanTask({
      id: 'review-1',
      processInstanceId: 'inst-a',
      stepId: 'grade-aes',
      creationReason: 'agent_review_l3',
      completionData: { reviewType: 'agent_output_review', agentOutput: { agentRunId: AGENT_RUN_ID } },
      ...overrides,
    });
  }

  it('maps the verdict intent from the task\'s own vocabulary to 0 / 0.5 / 1', async () => {
    const task = reviewTask({
      verdicts: [
        { key: 'unsafe', label: 'Unsafe', intent: 'danger', requiresComment: false },
        { key: 'recheck', label: 'Recheck', intent: 'warning', requiresComment: false },
      ],
    });

    const unsafe = await recordHumanVerdictScore(
      { task, payload: { kind: 'verdict', verdict: 'unsafe' }, actorId: 'u-1', namespace: 'team-alpha' },
      scope(),
    );
    const recheck = await recordHumanVerdictScore(
      { task, payload: { kind: 'verdict-with-params', verdict: 'recheck', comment: '  ', paramValues: {} }, actorId: 'u-1', namespace: 'team-alpha' },
      scope(),
    );

    expect(unsafe).toMatchObject({ value: 0, label: 'unsafe', comment: null });
    expect(recheck).toMatchObject({ value: 0.5, label: 'recheck', comment: null });
  });

  it('falls back to the step\'s latest Agent Run started before the review for a task that predates agentRunId', async () => {
    await agentRunRepo.create(buildAgentRun({
      id: AGENT_RUN_ID, processInstanceId: 'inst-a', stepId: 'grade-aes', startedAt: '2026-09-23T09:00:00.000Z',
    }));
    await agentRunRepo.create(buildAgentRun({
      id: 'older-run', processInstanceId: 'inst-a', stepId: 'grade-aes', startedAt: '2026-09-23T08:00:00.000Z',
    }));
    await agentRunRepo.create(buildAgentRun({
      id: 'rerun-after-review', processInstanceId: 'inst-a', stepId: 'grade-aes', startedAt: '2026-09-23T11:00:00.000Z',
    }));
    await agentRunRepo.create(buildAgentRun({
      id: 'other-step', processInstanceId: 'inst-a', stepId: 'extract', startedAt: '2026-09-23T09:30:00.000Z',
    }));

    const score = await recordHumanVerdictScore(
      {
        task: reviewTask({
          createdAt: '2026-09-23T10:00:00.000Z',
          completionData: { reviewType: 'agent_output_review', agentOutput: { confidence: 0.4 } },
        }),
        payload: { kind: 'verdict', verdict: 'revise', comment: 'Recheck the grade' },
        actorId: 'u-1',
        namespace: 'team-alpha',
      },
      scope(),
    );

    expect(score).toMatchObject({ subject: { type: 'agent_run', id: AGENT_RUN_ID }, value: 0.5 });
  });

  it('records nothing for a review task whose agentRunId is null, even when the step has Agent Runs', async () => {
    await agentRunRepo.create(buildAgentRun({
      id: AGENT_RUN_ID, processInstanceId: 'inst-a', stepId: 'grade-aes', startedAt: '2026-09-23T09:00:00.000Z',
    }));

    const score = await recordHumanVerdictScore(
      {
        task: reviewTask({ completionData: { reviewType: 'agent_output_review', agentOutput: { agentRunId: null } } }),
        payload: { kind: 'verdict', verdict: 'revise', comment: 'Recheck the grade' },
        actorId: 'u-1',
        namespace: 'team-alpha',
      },
      scope(),
    );

    expect(score).toBeNull();
    expect(await scoreRepo.list({ limit: 10 })).toEqual([]);
  });

  it('records nothing for a task that predates agentRunId when every step run started after the review opened', async () => {
    await agentRunRepo.create(buildAgentRun({
      id: 'rerun-after-review', processInstanceId: 'inst-a', stepId: 'grade-aes', startedAt: '2026-09-23T11:00:00.000Z',
    }));

    const score = await recordHumanVerdictScore(
      {
        task: reviewTask({
          createdAt: '2026-09-23T10:00:00.000Z',
          completionData: { reviewType: 'agent_output_review', agentOutput: { confidence: 0.4 } },
        }),
        payload: { kind: 'verdict', verdict: 'approve' },
        actorId: 'u-1',
        namespace: 'team-alpha',
      },
      scope(),
    );

    expect(score).toBeNull();
    expect(await scoreRepo.list({ limit: 10 })).toEqual([]);
  });

  it('records nothing for a review task without agent review data', async () => {
    const score = await recordHumanVerdictScore(
      {
        task: reviewTask({ completionData: null }),
        payload: { kind: 'verdict', verdict: 'approve' },
        actorId: 'u-1',
        namespace: 'team-alpha',
      },
      scope(),
    );

    expect(score).toBeNull();
    expect(await scoreRepo.list({ limit: 10 })).toEqual([]);
  });

  it('records nothing for a payload without a verdict', async () => {
    const score = await recordHumanVerdictScore(
      { task: reviewTask(), payload: { kind: 'params', paramValues: {} }, actorId: 'u-1', namespace: 'team-alpha' },
      scope(),
    );

    expect(score).toBeNull();
  });
});
