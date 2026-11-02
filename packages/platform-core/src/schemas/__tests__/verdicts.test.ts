import { describe, it, expect } from 'vitest';
import {
  buildAgentReviewTaskVerdicts,
  buildHumanTaskVerdicts,
  buildTaskVerdicts,
  commentVerdictKeys,
  isParamRequired,
  defaultRequiresComment,
  defaultVerdictIntent,
  defaultVerdictLabel,
} from '../verdicts';

describe('defaultVerdictLabel', () => {
  it('returns "Approve" for approve', () => {
    expect(defaultVerdictLabel('approve')).toBe('Approve');
  });

  it('returns "Request changes" for revise', () => {
    expect(defaultVerdictLabel('revise')).toBe('Request changes');
  });

  it('humanizes snake_case keys', () => {
    expect(defaultVerdictLabel('reject_and_notify')).toBe('Reject And Notify');
  });

  it('humanizes kebab-case keys', () => {
    expect(defaultVerdictLabel('ask-agent-to-revise')).toBe('Ask Agent To Revise');
  });

  it('capitalizes a single-word key', () => {
    expect(defaultVerdictLabel('accept')).toBe('Accept');
  });
});

describe('defaultVerdictIntent', () => {
  it('returns "success" for approve', () => {
    expect(defaultVerdictIntent('approve')).toBe('success');
  });

  it('returns "warning" for revise', () => {
    expect(defaultVerdictIntent('revise')).toBe('warning');
  });

  it('returns "neutral" for unknown keys', () => {
    expect(defaultVerdictIntent('reject')).toBe('neutral');
    expect(defaultVerdictIntent('escalate')).toBe('neutral');
  });
});

describe('defaultRequiresComment', () => {
  it('requires a comment for revise', () => {
    expect(defaultRequiresComment('revise')).toBe(true);
  });

  it('does not require a comment for approve', () => {
    expect(defaultRequiresComment('approve')).toBe(false);
  });

  it('does not require a comment for unknown keys', () => {
    expect(defaultRequiresComment('reject')).toBe(false);
  });
});

describe('buildTaskVerdicts', () => {
  it('returns undefined for missing or empty verdicts', () => {
    expect(buildTaskVerdicts(undefined)).toBeUndefined();
    expect(buildTaskVerdicts({})).toBeUndefined();
  });

  it('returns an ordered array preserving WD insertion order', () => {
    const out = buildTaskVerdicts({
      approve: { target: 'done' },
      revise: { target: 'scan' },
    });
    expect(out).toEqual([
      { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
      { key: 'revise', label: 'Request changes', intent: 'warning', requiresComment: true },
    ]);
  });

  it('respects explicit overrides on label/intent/requiresComment', () => {
    const out = buildTaskVerdicts({
      accept: { target: 'accept-delivery', label: 'Accept delivery', intent: 'success' },
      reject_and_notify: {
        target: 'draft-rejection-note',
        label: 'Reject — notify CRO',
        intent: 'danger',
        requiresComment: true,
      },
    });
    expect(out).toEqual([
      { key: 'accept', label: 'Accept delivery', intent: 'success', requiresComment: false },
      { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger', requiresComment: true },
    ]);
  });

  it('does not include the target field in the output', () => {
    const out = buildTaskVerdicts({ approve: { target: 'done' } });
    expect(out?.[0]).not.toHaveProperty('target');
  });

  it('defaults a custom (non approve/revise) key with only target to neutral intent + no comment required', () => {
    const out = buildTaskVerdicts({ escalate: { target: 'oncall' } });
    expect(out).toEqual([
      { key: 'escalate', label: 'Escalate', intent: 'neutral', requiresComment: false },
    ]);
  });
});

describe('step comment requirement', () => {
  const verdicts = {
    approve: { target: 'done' },
    revise: { target: 'scan', requiresComment: true },
  };

  it('lets comment.requiredForVerdicts decide, over the verdict and its default', () => {
    const out = buildTaskVerdicts(verdicts, { requiredForVerdicts: ['approve'] });
    expect(out?.map(({ key, requiresComment }) => [key, requiresComment])).toEqual([
      ['approve', true],
      ['revise', false],
    ]);
  });

  it('makes no comment required with an empty list', () => {
    const out = buildTaskVerdicts(verdicts, { requiredForVerdicts: [] });
    expect(out?.every(({ requiresComment }) => requiresComment === false)).toBe(true);
  });

  it('builds approve and revise for an agent review with no verdicts of its own', () => {
    expect(buildAgentReviewTaskVerdicts(undefined, undefined)).toEqual([
      { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
      { key: 'revise', label: 'Request changes', intent: 'warning', requiresComment: true },
    ]);
  });

  it('applies the step comment setting and verdict labels to an agent review', () => {
    const out = buildAgentReviewTaskVerdicts(
      { revise: { target: 'scan', label: 'Send back' } },
      { requiredForVerdicts: [] },
    );
    expect(out).toEqual([
      { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
      { key: 'revise', label: 'Send back', intent: 'warning', requiresComment: false },
    ]);
  });
});

describe('a human step with no verdicts of its own', () => {
  const comment = { requiredForVerdicts: [] };

  it('offers the approve and revise its verdict form shows', () => {
    expect(commentVerdictKeys({ executor: 'human' })).toEqual(['approve', 'revise']);
  });

  it('offers nothing when its form has no comment box', () => {
    expect(commentVerdictKeys({ executor: 'human', params: [{ name: 'reason' }] })).toEqual([]);
    expect(commentVerdictKeys({ executor: 'human', ui: { component: 'file-upload' } })).toEqual([]);
  });

  it('offers the verdicts it declares, or both on an agent review', () => {
    expect(commentVerdictKeys({ executor: 'human', verdicts: { accept: { target: 'done' } }, params: [{ name: 'reason' }] })).toEqual(['accept']);
    expect(commentVerdictKeys({ executor: 'agent' })).toEqual(['approve', 'revise']);
    expect(commentVerdictKeys({ executor: 'agent', selection: 2 })).toEqual(['revise']);
    expect(commentVerdictKeys({ executor: 'human', selection: 2 })).toEqual(['revise']);
  });

  it('carries the setting onto the task', () => {
    expect(buildHumanTaskVerdicts({ executor: 'human', comment })).toEqual([
      { key: 'approve', label: 'Approve', intent: 'success', requiresComment: false },
      { key: 'revise', label: 'Request changes', intent: 'warning', requiresComment: false },
    ]);
  });

  it('leaves the task as it was with no setting', () => {
    expect(buildHumanTaskVerdicts({ executor: 'human' })).toBeUndefined();
  });

  it('never gives a params-only task verdicts, which would change its kind', () => {
    expect(buildHumanTaskVerdicts({ executor: 'human', comment, params: [{ name: 'reason' }] })).toBeUndefined();
  });
});

describe('isParamRequired', () => {
  it('counts any verdict in requiredForVerdicts as required', () => {
    expect(isParamRequired({ required: false, requiredForVerdicts: ['revise'] })).toBe(true);
  });

  it('follows required when no verdict is named', () => {
    expect(isParamRequired({ required: true })).toBe(true);
    expect(isParamRequired({ required: false })).toBe(false);
    expect(isParamRequired({ required: false, requiredForVerdicts: [] })).toBe(false);
  });
});
