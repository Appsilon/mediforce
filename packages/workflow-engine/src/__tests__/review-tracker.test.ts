import { describe, it, expect, beforeEach } from 'vitest';
import type { ReviewVerdict } from '@mediforce/platform-core';
import { ReviewTracker } from '../index.js';

function makeVerdict(overrides: Partial<ReviewVerdict> = {}): ReviewVerdict {
  return {
    reviewerId: 'reviewer-1',
    reviewerRole: 'qa-lead',
    verdict: 'approve',
    comment: null,
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ReviewTracker', () => {
  let tracker: ReviewTracker;

  beforeEach(() => {
    tracker = new ReviewTracker();
  });

  it('addVerdict() stores verdict in the state for the step', () => {
    const verdict = makeVerdict({ verdict: 'revise', comment: 'Needs work' });
    tracker.addVerdict('review-step', verdict);
    const verdicts = tracker.getVerdicts('review-step');
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].verdict).toBe('revise');
    expect(verdicts[0].comment).toBe('Needs work');
  });

  it('addVerdict() appends multiple verdicts for the same step', () => {
    tracker.addVerdict('review-step', makeVerdict({ verdict: 'revise' }));
    tracker.addVerdict('review-step', makeVerdict({ verdict: 'approve' }));
    const verdicts = tracker.getVerdicts('review-step');
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].verdict).toBe('revise');
    expect(verdicts[1].verdict).toBe('approve');
  });

  it('getVerdicts(stepId) returns all verdicts for that step', () => {
    tracker.addVerdict('step-a', makeVerdict({ verdict: 'approve' }));
    tracker.addVerdict('step-a', makeVerdict({ verdict: 'reject' }));
    const verdicts = tracker.getVerdicts('step-a');
    expect(verdicts).toHaveLength(2);
  });

  it('getVerdicts(stepId) returns empty array for unknown step', () => {
    expect(tracker.getVerdicts('nonexistent')).toEqual([]);
  });

  it('incrementIteration(stepId) increments the iteration counter', () => {
    tracker.incrementIteration('review-step');
    expect(tracker.getCurrentIteration('review-step')).toBe(1);
    tracker.incrementIteration('review-step');
    expect(tracker.getCurrentIteration('review-step')).toBe(2);
  });

  it('getCurrentIteration(stepId) returns 0 for uninitialized step', () => {
    expect(tracker.getCurrentIteration('fresh-step')).toBe(0);
  });

  it('isMaxIterationsExceeded returns true when count >= limit', () => {
    tracker.incrementIteration('review-step');
    tracker.incrementIteration('review-step');
    tracker.incrementIteration('review-step');
    expect(tracker.isMaxIterationsExceeded('review-step', 3)).toBe(true);
  });

  it('isMaxIterationsExceeded returns false when under limit', () => {
    tracker.incrementIteration('review-step');
    expect(tracker.isMaxIterationsExceeded('review-step', 3)).toBe(false);
  });

  it('handles multiple review steps independently (state is per stepId)', () => {
    tracker.addVerdict('step-a', makeVerdict({ verdict: 'approve' }));
    tracker.incrementIteration('step-a');
    tracker.addVerdict('step-b', makeVerdict({ verdict: 'revise' }));

    expect(tracker.getVerdicts('step-a')).toHaveLength(1);
    expect(tracker.getVerdicts('step-b')).toHaveLength(1);
    expect(tracker.getCurrentIteration('step-a')).toBe(1);
    expect(tracker.getCurrentIteration('step-b')).toBe(0);
  });

  it('reset(stepId) clears verdicts and iteration count for a step', () => {
    tracker.addVerdict('review-step', makeVerdict());
    tracker.incrementIteration('review-step');
    tracker.incrementIteration('review-step');

    tracker.reset('review-step');

    expect(tracker.getVerdicts('review-step')).toEqual([]);
    expect(tracker.getCurrentIteration('review-step')).toBe(0);
  });
});
