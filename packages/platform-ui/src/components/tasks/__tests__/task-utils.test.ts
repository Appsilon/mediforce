import { describe, it, expect } from 'vitest';
import { buildHumanTask, resetFactorySequence } from '@mediforce/platform-core/testing';
import { getAgentOutput, getAgentOutputFromSiblings } from '../task-utils';
import type { HumanTask } from '@mediforce/platform-core';

function taskWithAgentOutput(
  overrides: Partial<HumanTask> & { presentation?: string },
): HumanTask {
  const { presentation = null, ...rest } = overrides;
  return buildHumanTask({
    completionData: {
      agentOutput: {
        confidence: 0.9,
        confidence_rationale: 'test',
        reasoning: 'test reasoning',
        result: { ok: true },
        model: 'sonnet',
        duration_ms: 1000,
        gitMetadata: null,
        presentation,
      },
    },
    ...rest,
  });
}

describe('getAgentOutput', () => {
  beforeEach(() => resetFactorySequence());

  it('[DATA] extracts presentation from task completionData', () => {
    const task = taskWithAgentOutput({ presentation: '<h1>Report v1</h1>' });
    const output = getAgentOutput(task);
    expect(output).not.toBeNull();
    expect(output!.presentation).toBe('<h1>Report v1</h1>');
  });

  it('[DATA] returns null when no agentOutput in completionData', () => {
    const task = buildHumanTask({ completionData: null });
    expect(getAgentOutput(task)).toBeNull();
  });

  it('[DATA] returns null presentation when presentation field is missing', () => {
    const task = buildHumanTask({
      completionData: {
        agentOutput: {
          confidence: 0.5,
          result: { ok: true },
        },
      },
    });
    const output = getAgentOutput(task);
    expect(output).not.toBeNull();
    expect(output!.presentation).toBeNull();
  });
});

describe('getAgentOutputFromSiblings', () => {
  beforeEach(() => resetFactorySequence());

  it('[DATA] returns output from the closest preceding sibling, not the first', () => {
    // Simulates: agent1 → review1 → agent2 → review2
    // When viewing review1, should get agent1's output (not agent2's)
    const agent1 = taskWithAgentOutput({
      id: 'agent-1',
      stepId: 'assess',
      createdAt: '2026-01-15T10:00:00Z',
      presentation: '<h1>Report v1</h1>',
    });
    const review1 = buildHumanTask({
      id: 'review-1',
      stepId: 'assess',
      createdAt: '2026-01-15T10:01:00Z',
      completionData: null,
    });
    const agent2 = taskWithAgentOutput({
      id: 'agent-2',
      stepId: 'assess',
      createdAt: '2026-01-15T10:02:00Z',
      presentation: '<h1>Report v2</h1>',
    });
    const review2 = buildHumanTask({
      id: 'review-2',
      stepId: 'assess',
      createdAt: '2026-01-15T10:03:00Z',
      completionData: null,
    });

    const siblings = [agent1, review1, agent2, review2]; // ordered by createdAt asc

    const outputForReview1 = getAgentOutputFromSiblings(review1, siblings);
    expect(outputForReview1).not.toBeNull();
    expect(outputForReview1!.presentation).toBe('<h1>Report v1</h1>');

    const outputForReview2 = getAgentOutputFromSiblings(review2, siblings);
    expect(outputForReview2).not.toBeNull();
    expect(outputForReview2!.presentation).toBe('<h1>Report v2</h1>');
  });

  it('[DATA] returns null when no preceding sibling has output', () => {
    const review = buildHumanTask({
      id: 'review-1',
      stepId: 'assess',
      completionData: null,
    });
    const otherTask = buildHumanTask({
      id: 'other-1',
      stepId: 'different-step',
      completionData: null,
    });

    const siblings = [review, otherTask];
    expect(getAgentOutputFromSiblings(review, siblings)).toBeNull();
  });

  it('[DATA] skips siblings with different stepId', () => {
    const agentDifferentStep = taskWithAgentOutput({
      id: 'agent-other',
      stepId: 'other-step',
      createdAt: '2026-01-15T09:59:00Z',
      presentation: '<h1>Wrong step</h1>',
    });
    const review = buildHumanTask({
      id: 'review-1',
      stepId: 'assess',
      createdAt: '2026-01-15T10:01:00Z',
      completionData: null,
    });

    const siblings = [agentDifferentStep, review];
    expect(getAgentOutputFromSiblings(review, siblings)).toBeNull();
  });
});
