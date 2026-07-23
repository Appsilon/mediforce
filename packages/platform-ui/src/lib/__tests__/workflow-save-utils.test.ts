import { describe, it, expect } from 'vitest';
import { workflowDisplayName, DISPLAY_NAME_KEY } from '../workflow-save-utils';

describe('workflowDisplayName', () => {
  it('returns the preserved display name verbatim (exact casing) when present', () => {
    expect(workflowDisplayName({
      name: 'linkedin-posts-filter',
      metadata: { [DISPLAY_NAME_KEY]: 'LinkedIn Posts Filter' },
    })).toBe('LinkedIn Posts Filter');
  });

  it('falls back to the title-cased slug for workflows without a display name (backwards compatible)', () => {
    expect(workflowDisplayName({ name: 'linkedin-posts-filter' })).toBe('Linkedin Posts Filter');
    expect(workflowDisplayName({ name: 'etymology', metadata: {} })).toBe('Etymology');
  });

  it('ignores an empty / whitespace / non-string display name and falls back', () => {
    expect(workflowDisplayName({ name: 'my-flow', metadata: { [DISPLAY_NAME_KEY]: '  ' } })).toBe('My Flow');
    expect(workflowDisplayName({ name: 'my-flow', metadata: { [DISPLAY_NAME_KEY]: 42 } })).toBe('My Flow');
  });
});
