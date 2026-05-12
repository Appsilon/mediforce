import { describe, it, expect } from 'vitest';
import {
  buildTaskVerdicts,
  defaultRequiresComment,
  defaultVerdictIntent,
  defaultVerdictLabel,
  isVerdictAllowed,
} from '../verdicts.js';

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

  it('fills defaults from the verdict key when fields are omitted', () => {
    const out = buildTaskVerdicts({
      approve: { target: 'done' },
      revise: { target: 'scan' },
    });
    expect(out).toEqual({
      approve: { label: 'Approve', intent: 'success', requiresComment: false },
      revise: { label: 'Request changes', intent: 'warning', requiresComment: true },
    });
  });

  it('respects explicit overrides on label/intent/requiresComment', () => {
    const out = buildTaskVerdicts({
      accept: {
        target: 'accept-delivery',
        label: 'Accept delivery',
        intent: 'success',
      },
      reject_and_notify: {
        target: 'draft-rejection-note',
        label: 'Reject — notify CRO',
        intent: 'danger',
        requiresComment: true,
      },
    });
    expect(out).toEqual({
      accept: { label: 'Accept delivery', intent: 'success', requiresComment: false },
      reject_and_notify: {
        label: 'Reject — notify CRO',
        intent: 'danger',
        requiresComment: true,
      },
    });
  });

  it('does not include the target field in the output', () => {
    const out = buildTaskVerdicts({ approve: { target: 'done' } });
    expect(out?.approve).not.toHaveProperty('target');
  });
});

describe('isVerdictAllowed', () => {
  it('returns true when the verdict key is in the step config', () => {
    expect(isVerdictAllowed({ approve: { target: 'done' } }, 'approve')).toBe(true);
  });

  it('returns false when the verdict key is missing', () => {
    expect(isVerdictAllowed({ approve: { target: 'done' } }, 'revise')).toBe(false);
  });

  it('returns false when stepVerdicts is undefined', () => {
    expect(isVerdictAllowed(undefined, 'approve')).toBe(false);
  });
});
