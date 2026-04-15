import { describe, it, expect } from 'vitest';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { getAgentOutput, getAgentOutputFromSiblings } from '../task-utils';

const SHARED_STEP = 'step-review';
const SHARED_INSTANCE = 'inst-shared';

describe('getAgentOutputFromSiblings', () => {
  it('[DATA] returns output from preceding sibling, not first sibling', () => {
    const agent1 = buildHumanTask({
      stepId: SHARED_STEP,
      processInstanceId: SHARED_INSTANCE,
      completionData: { agentOutput: { presentation: 'v1' } },
    });
    const review1 = buildHumanTask({
      stepId: SHARED_STEP,
      processInstanceId: SHARED_INSTANCE,
    });
    const agent2 = buildHumanTask({
      stepId: SHARED_STEP,
      processInstanceId: SHARED_INSTANCE,
      completionData: { agentOutput: { presentation: 'v2' } },
    });
    const review2 = buildHumanTask({
      stepId: SHARED_STEP,
      processInstanceId: SHARED_INSTANCE,
    });

    // Siblings in createdAt-asc order: agent1, review1, agent2, review2
    const siblings = [agent1, review1, agent2, review2];

    // For review1, the nearest preceding sibling with output is agent1 ("v1")
    const outputForReview1 = getAgentOutputFromSiblings(review1, siblings);
    expect(outputForReview1).not.toBeNull();
    expect(outputForReview1!.presentation).toBe('v1');

    // For review2, the nearest preceding sibling with output is agent2 ("v2")
    const outputForReview2 = getAgentOutputFromSiblings(review2, siblings);
    expect(outputForReview2).not.toBeNull();
    expect(outputForReview2!.presentation).toBe('v2');
  });

  it('[DATA] returns null when no preceding sibling has output', () => {
    const review = buildHumanTask({
      stepId: SHARED_STEP,
      processInstanceId: SHARED_INSTANCE,
    });
    const agent = buildHumanTask({
      stepId: SHARED_STEP,
      processInstanceId: SHARED_INSTANCE,
      completionData: { agentOutput: { presentation: 'later' } },
    });

    // review is first — no preceding sibling with output
    const siblings = [review, agent];
    const output = getAgentOutputFromSiblings(review, siblings);
    expect(output).toBeNull();
  });
});

describe('getAgentOutput', () => {
  it('[DATA] extracts presentation from task completionData', () => {
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
    expect(output!.presentation).toBe('<div>some html</div>');
    expect(output!.confidence).toBe(0.95);
    expect(output!.reasoning).toBe('looks good');
  });
});
