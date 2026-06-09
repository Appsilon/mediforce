import { describe, it, expect } from 'vitest';
import type { HumanTask, CompleteHumanTaskPayload } from '@mediforce/platform-core';
import {
  resolveTaskKind,
  shapeCompletion,
  validatePayloadKindMatchesTask,
  validateVerdictPayload,
  validateUploadPayload,
} from '../complete-human-task';
import { CompleteHumanTaskValidationError } from '../errors';

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
  it('params when task has params but no verdicts', () => {
    expect(
      resolveTaskKind(
        baseTask({ params: [{ key: 'k', label: 'k', type: 'string' }] as never }),
      ),
    ).toBe('params');
  });
  it('verdict-with-params when task has both params and verdicts', () => {
    expect(
      resolveTaskKind(
        baseTask({
          params: [{ key: 'k', label: 'k', type: 'string' }] as never,
          verdicts: [{ key: 'approve', label: 'Approve', intent: 'positive' as never }] as never,
        }),
      ),
    ).toBe('verdict-with-params');
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
  it('passes for verdict-with-params when task has both params and verdicts', () => {
    const task = baseTask({
      params: [{ key: 'dose', label: 'Dose', type: 'string' }] as never,
      verdicts: [{ key: 'approve', label: 'Approve', intent: 'positive' as never }] as never,
    });
    expect(() =>
      validatePayloadKindMatchesTask(task, {
        kind: 'verdict-with-params',
        verdict: 'approve',
        paramValues: { dose: '10mg' },
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

describe('shapeCompletion — verdict-with-params variant', () => {
  function verdictWithParamsTask() {
    return baseTask({
      params: [{ key: 'dose', label: 'Dose', type: 'string' }] as never,
      verdicts: [
        { key: 'approve', label: 'Approve', intent: 'positive' as never },
        { key: 'reject', label: 'Reject', intent: 'negative' as never, requiresComment: true },
      ] as never,
    });
  }

  it('merges paramValues + verdict into flat stepOutput', () => {
    const result = shapeCompletion(
      verdictWithParamsTask(),
      { kind: 'verdict-with-params', verdict: 'approve', paramValues: { dose: '10mg' }, comment: 'looks good' },
      'user-1',
      '2026-06-03T00:00:00.000Z',
    );
    expect(result.stepOutput.dose).toBe('10mg');
    expect(result.stepOutput.verdict).toBe('approve');
    expect(result.stepOutput.comment).toBe('looks good');
    expect(result.isL3Revise).toBe(false);
  });

  it('stores trimmed comment and omits empty comment from stepOutput', () => {
    const result = shapeCompletion(
      verdictWithParamsTask(),
      { kind: 'verdict-with-params', verdict: 'approve', paramValues: {}, comment: '  ' },
      'user-1',
      '2026-06-03T00:00:00.000Z',
    );
    expect(result.stepOutput.comment).toBeUndefined();
    expect(result.completionData.comment).toBeUndefined();
  });

  it('omits comment from completionData when not provided', () => {
    const result = shapeCompletion(
      verdictWithParamsTask(),
      { kind: 'verdict-with-params', verdict: 'approve', paramValues: { dose: '5mg' } },
      'user-1',
      '2026-06-03T00:00:00.000Z',
    );
    expect(result.completionData.comment).toBeUndefined();
    expect(result.completionData.verdict).toBe('approve');
    expect(result.completionData.paramValues).toEqual({ dose: '5mg' });
  });

  it('rejects a verdict not in the task allowlist', () => {
    expect(() =>
      shapeCompletion(
        verdictWithParamsTask(),
        { kind: 'verdict-with-params', verdict: 'maybe', paramValues: {} },
        'user-1',
        '2026-06-03T00:00:00.000Z',
      ),
    ).toThrow(/verdict 'maybe' not allowed/);
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
