import { describe, it, expect } from 'vitest';
import { isStuckLoop, createLoopTracker, MAX_SAME_STEP_ITERATIONS } from '../loop-guard';

describe('isStuckLoop', () => {
  it('[DATA] returns false for first execution of a step', () => {
    const tracker = createLoopTracker();
    expect(isStuckLoop('step-1', tracker)).toBe(false);
  });

  it('[DATA] returns false when step changes each iteration', () => {
    const tracker = createLoopTracker();
    expect(isStuckLoop('step-1', tracker)).toBe(false);
    expect(isStuckLoop('step-2', tracker)).toBe(false);
    expect(isStuckLoop('step-3', tracker)).toBe(false);
    expect(isStuckLoop('step-4', tracker)).toBe(false);
  });

  it(`[DATA] returns true after ${MAX_SAME_STEP_ITERATIONS} consecutive same-step iterations`, () => {
    const tracker = createLoopTracker();
    // First visit — sets previousStepId, count stays 0
    expect(isStuckLoop('step-1', tracker)).toBe(false);
    // Second same visit — count becomes 1
    expect(isStuckLoop('step-1', tracker)).toBe(false);
    // Third same visit — count becomes 2
    expect(isStuckLoop('step-1', tracker)).toBe(false);
    // Fourth same visit — count becomes 3 >= MAX_SAME_STEP_ITERATIONS → stuck
    expect(isStuckLoop('step-1', tracker)).toBe(true);
  });

  it('[DATA] resets counter when step changes', () => {
    const tracker = createLoopTracker();
    expect(isStuckLoop('step-1', tracker)).toBe(false);
    expect(isStuckLoop('step-1', tracker)).toBe(false); // count=1
    // Step changes — counter resets
    expect(isStuckLoop('step-2', tracker)).toBe(false);
    // Back to step-1 — counter starts fresh
    expect(isStuckLoop('step-1', tracker)).toBe(false);
    expect(isStuckLoop('step-1', tracker)).toBe(false); // count=1
    expect(isStuckLoop('step-1', tracker)).toBe(false); // count=2
    expect(isStuckLoop('step-1', tracker)).toBe(true);  // count=3 → stuck
  });

  it('[DATA] legitimate ping-pong (review → revise → review) does not trigger', () => {
    const tracker = createLoopTracker();
    // Simulates: generate → review → generate → review (verdict back-and-forth)
    for (let i = 0; i < 10; i++) {
      expect(isStuckLoop('generate', tracker)).toBe(false);
      expect(isStuckLoop('review', tracker)).toBe(false);
    }
  });

  it('[DATA] handles null currentStepId', () => {
    const tracker = createLoopTracker();
    // tracker starts with previousStepId=null, so null matches immediately
    expect(isStuckLoop(null, tracker)).toBe(false); // count=1
    expect(isStuckLoop(null, tracker)).toBe(false); // count=2
    expect(isStuckLoop(null, tracker)).toBe(true);  // count=3 → stuck
  });
});
