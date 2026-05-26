import { describe, it, expect } from 'vitest';
import type { HumanTask, CompleteHumanTaskPayload } from '@mediforce/platform-core';
import {
  resolveTaskKind,
  shapeCompletion,
  validatePayloadKindMatchesTask,
  validateVerdictPayload,
  validateUploadPayload,
} from '../complete-human-task.js';
import { CompleteHumanTaskValidationError } from '../errors.js';

function baseTask(overrides: Partial<HumanTask> = {}): HumanTask {
  return {
    id: 'task-1',
    processInstanceId: 'inst-1',
    stepId: 'step-1',
    assignedRole: 'reviewer',
    assignedUserId: 'user-1',
    status: 'claimed',
    deadline: null,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    completedAt: null,
    completionData: null,
    creationReason: 'human_executor',
    ...overrides,
  } as HumanTask;
}

describe('resolveTaskKind', () => {
  it('upload for file-upload ui component', () => {
    expect(resolveTaskKind(baseTask({ ui: { component: 'file-upload' } as never }))).toBe('upload');
  });
  it('assignment for assignment-table', () => {
    expect(resolveTaskKind(baseTask({ ui: { component: 'assignment-table' } as never }))).toBe(
      'assignment',
    );
  });
  it('rows for table-editor', () => {
    expect(resolveTaskKind(baseTask({ ui: { component: 'table-editor' } as never }))).toBe('rows');
  });
  it('params when task.params has entries', () => {
    expect(
      resolveTaskKind(
        baseTask({ params: [{ key: 'k', label: 'k', type: 'string' }] as never }),
      ),
    ).toBe('params');
  });
  it('verdict by default', () => {
    expect(resolveTaskKind(baseTask())).toBe('verdict');
  });
});

describe('validatePayloadKindMatchesTask', () => {
  it('throws when payload kind does not match task kind', () => {
    const task = baseTask({ ui: { component: 'file-upload' } as never });
    expect(() =>
      validatePayloadKindMatchesTask(task, {
        kind: 'verdict',
        verdict: 'approve',
      }),
    ).toThrow(CompleteHumanTaskValidationError);
  });
  it('passes when kinds match', () => {
    const task = baseTask();
    expect(() =>
      validatePayloadKindMatchesTask(task, {
        kind: 'verdict',
        verdict: 'approve',
      }),
    ).not.toThrow();
  });
});

describe('validateVerdictPayload', () => {
  it('rejects verdict outside task.verdicts allowlist', () => {
    const task = baseTask({
      verdicts: [
        { key: 'approve', label: 'Approve', intent: 'positive' as never },
      ] as never,
    });
    expect(() =>
      validateVerdictPayload(task, { kind: 'verdict', verdict: 'reject' }),
    ).toThrow(/verdict 'reject' not allowed/);
  });

  it('enforces requiresComment for verdicts that mandate one', () => {
    const task = baseTask({
      verdicts: [
        {
          key: 'reject',
          label: 'Reject',
          intent: 'negative' as never,
          requiresComment: true,
        },
      ] as never,
    });
    expect(() =>
      validateVerdictPayload(task, { kind: 'verdict', verdict: 'reject' }),
    ).toThrow(/requires a non-empty comment/);
    expect(() =>
      validateVerdictPayload(task, {
        kind: 'verdict',
        verdict: 'reject',
        comment: '   ',
      }),
    ).toThrow(/requires a non-empty comment/);
    expect(() =>
      validateVerdictPayload(task, {
        kind: 'verdict',
        verdict: 'reject',
        comment: 'no good',
      }),
    ).not.toThrow();
  });
});

describe('validateUploadPayload', () => {
  it('enforces uiConfig.minFiles/maxFiles', () => {
    const task = baseTask({
      ui: {
        component: 'file-upload',
        config: { minFiles: 2, maxFiles: 3 },
      } as never,
    });
    const oneFile: CompleteHumanTaskPayload = {
      kind: 'upload',
      attachments: [{ name: 'a.pdf', size: 1, type: 'application/pdf' }],
    };
    expect(() => validateUploadPayload(task, oneFile as never)).toThrow(/Expected 2-3 file/);
  });
});

describe('shapeCompletion — verdict variant', () => {
  it('builds stepOutput with verdict + reviewer feedback fence on non-empty comment', () => {
    const task = baseTask();
    const result = shapeCompletion(
      task,
      { kind: 'verdict', verdict: 'revise', comment: 'try harder' },
      'user-1',
      '2026-05-26T00:00:00.000Z',
    );
    expect(result.stepOutput.verdict).toBe('revise');
    expect(result.stepOutput.reviewerComment).toBe('try harder');
    expect(String(result.stepOutput.reviewerCallToAction)).toContain('SOURCE OF TRUTH');
    expect(result.isL3Revise).toBe(false);
  });

  it('marks isL3Revise true for revise on an agent_review_l3 task', () => {
    const task = baseTask({ creationReason: 'agent_review_l3' as never });
    const result = shapeCompletion(
      task,
      { kind: 'verdict', verdict: 'revise', comment: 'redo' },
      'user-1',
      '2026-05-26T00:00:00.000Z',
    );
    expect(result.isL3Revise).toBe(true);
  });

  it('rejects approve when agent_output_review has empty agentOutput.result', () => {
    const task = baseTask({
      completionData: {
        reviewType: 'agent_output_review',
        agentOutput: { result: {} },
      } as never,
    });
    expect(() =>
      shapeCompletion(
        task,
        { kind: 'verdict', verdict: 'approve' },
        'user-1',
        '2026-05-26T00:00:00.000Z',
      ),
    ).toThrow(/agent produced no output/);
  });
});
