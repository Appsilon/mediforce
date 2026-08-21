import { describe, expect, it } from 'vitest';
import { isEntryStep } from '../step-input';

describe('isEntryStep', () => {
  it('uses execution input until the workflow graph has loaded', () => {
    expect(isEntryStep(null, 'review')).toBe(false);
  });

  it('identifies a step with no incoming transition as the entry step', () => {
    expect(isEntryStep({ transitions: [{ from: 'review', to: 'publish' }] }, 'review')).toBe(true);
  });

  it('does not identify a step with an incoming transition as the entry step', () => {
    expect(isEntryStep({ transitions: [{ from: 'review', to: 'publish' }] }, 'publish')).toBe(false);
  });
});
