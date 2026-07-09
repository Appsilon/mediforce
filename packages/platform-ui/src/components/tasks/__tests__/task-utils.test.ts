import { describe, it, expect } from 'vitest';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { getAgentOutput } from '../task-utils';

describe('getAgentOutput', () => {
  it('[DATA] coerces a legacy raw-string presentation into {kind:html, content}', () => {
    const task = buildHumanTask({
      completionData: {
        agentOutput: {
          presentation: '<div>some html</div>',
          confidence: 0.95,
          reasoning: 'looks good',
        },
      },
    });

    const output = getAgentOutput(task);
    expect(output).not.toBeNull();
    expect(output!.presentation).toEqual({ kind: 'html', content: '<div>some html</div>' });
    expect(output!.confidence).toBe(0.95);
    expect(output!.reasoning).toBe('looks good');
  });

  it('[DATA] passes through a structured markdown presentation', () => {
    const task = buildHumanTask({
      completionData: {
        agentOutput: {
          presentation: { kind: 'markdown', content: '# Hi\n\n- one' },
        },
      },
    });

    const output = getAgentOutput(task);
    expect(output!.presentation).toEqual({ kind: 'markdown', content: '# Hi\n\n- one' });
  });

  it('[DATA] returns null presentation for malformed shapes', () => {
    const task = buildHumanTask({
      completionData: {
        agentOutput: {
          presentation: { kind: 'rich', content: 'nope' },
        },
      },
    });

    const output = getAgentOutput(task);
    expect(output!.presentation).toBeNull();
  });
});
