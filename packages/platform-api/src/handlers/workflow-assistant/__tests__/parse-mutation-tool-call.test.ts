import { describe, it, expect } from 'vitest';
import { parseMutationToolCall } from '../ask-workflow-assistant';

describe('parseMutationToolCall', () => {
  it('accepts a well-formed add_step call', () => {
    const parsed = parseMutationToolCall('add_step', { type: 'creation', executor: 'human', name: 'Intake' });
    expect(parsed.ok).toBe(true);
  });

  it('rejects a terminal add_step with an actionable hint, not just the raw enum error', () => {
    const parsed = parseMutationToolCall('add_step', { type: 'terminal', executor: 'human', name: 'Done' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.error).toMatch(/terminal steps are not added or edited/i);
    expect(parsed.error).toMatch(/existing terminal step's id/i);
  });

  it('rejects retargeting an existing step to terminal via update_step with the same hint', () => {
    const parsed = parseMutationToolCall('update_step', { stepId: 'review', type: 'terminal' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('expected rejection');
    expect(parsed.error).toMatch(/terminal steps are not added or edited/i);
  });
});
