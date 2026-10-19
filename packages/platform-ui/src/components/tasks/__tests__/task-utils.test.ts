import { describe, it, expect } from 'vitest';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { getAgentOutput } from '../task-utils';

describe('getAgentOutput', () => {
  it('[DATA] reads an L3 task written before ADR-0030, ignoring its presentation', () => {
    const task = buildHumanTask({
      completionData: {
        agentOutput: {
          presentation: '<div>some html</div>',
          confidence: 0.95,
          reasoning: 'looks good',
          result: { grade: 3 },
        },
      },
    });

    const output = getAgentOutput(task);
    expect(output).not.toBeNull();
    expect(output!.confidence).toBe(0.95);
    expect(output!.reasoning).toBe('looks good');
    expect(output!.result).toEqual({ grade: 3 });
    expect(output).not.toHaveProperty('presentation');
  });
});
