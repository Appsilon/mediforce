import { describe, it, expect } from 'vitest';
import {
  buildTaskVerdicts,
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
      { key: 'approve', label: 'Approve', intent: 'success' },
      { key: 'revise', label: 'Request changes', intent: 'warning' },
    ]);
  });

  it('respects explicit overrides on label/intent', () => {
    const out = buildTaskVerdicts({
      accept: { target: 'accept-delivery', label: 'Accept delivery', intent: 'success' },
      reject_and_notify: {
        target: 'draft-rejection-note',
        label: 'Reject — notify CRO',
        intent: 'danger',
      },
    });
    expect(out).toEqual([
      { key: 'accept', label: 'Accept delivery', intent: 'success' },
      { key: 'reject_and_notify', label: 'Reject — notify CRO', intent: 'danger' },
    ]);
  });

  it('does not include the target field in the output', () => {
    const out = buildTaskVerdicts({ approve: { target: 'done' } });
    expect(out?.[0]).not.toHaveProperty('target');
  });

  it('defaults a custom (non approve/revise) key with only target to neutral intent', () => {
    const out = buildTaskVerdicts({ escalate: { target: 'oncall' } });
    expect(out).toEqual([
      { key: 'escalate', label: 'Escalate', intent: 'neutral' },
    ]);
  });
});

