import { describe, it, expect } from 'vitest';
import type { ProcessInstance, StepExecution, Step } from '@mediforce/platform-core';
import { getEffectiveStatus } from '../step-status';

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    name: 'Step 1',
    type: 'task',
    ...overrides,
  } as Step;
}

function makeInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: 'i1',
    definitionName: 'wf',
    definitionVersion: '1',
    status: 'running',
    currentStepId: 'step-1',
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
    createdBy: 'u1',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    archived: false,
    ...overrides,
  } as ProcessInstance;
}

function makeExec(overrides: Partial<StepExecution> = {}): StepExecution {
  return {
    id: 'e1',
    instanceId: 'i1',
    stepId: 'step-1',
    status: 'completed',
    input: {},
    output: null,
    verdict: null,
    executedBy: 'agent:foo',
    startedAt: '2026-05-11T00:00:00.000Z',
    completedAt: '2026-05-11T00:01:00.000Z',
    iterationNumber: 0,
    gateResult: null,
    error: null,
    ...overrides,
  } as StepExecution;
}

describe('getEffectiveStatus', () => {
  it('returns "awaiting_approval" when exec completed but instance paused awaiting_agent_approval on this step', () => {
    const step = makeStep();
    const instance = makeInstance({ status: 'paused', pauseReason: 'awaiting_agent_approval', currentStepId: 'step-1' });
    const exec = makeExec({ status: 'completed' });

    expect(getEffectiveStatus(step, instance, [exec])).toBe('awaiting_approval');
  });

  it('returns "waiting" when exec completed but instance paused waiting_for_human on this step', () => {
    const step = makeStep();
    const instance = makeInstance({ status: 'paused', pauseReason: 'waiting_for_human', currentStepId: 'step-1' });
    const exec = makeExec({ status: 'completed' });

    expect(getEffectiveStatus(step, instance, [exec])).toBe('waiting');
  });

  it('returns "completed" when exec completed and currentStepId moved past this step', () => {
    const step = makeStep({ id: 'step-1' });
    const instance = makeInstance({ status: 'paused', pauseReason: 'awaiting_agent_approval', currentStepId: 'step-2' });
    const exec = makeExec({ status: 'completed', stepId: 'step-1' });

    expect(getEffectiveStatus(step, instance, [exec])).toBe('completed');
  });

  it('returns "completed" for terminal completed instance', () => {
    const step = makeStep();
    const instance = makeInstance({ status: 'completed', currentStepId: 'step-1' });
    const exec = makeExec({ status: 'completed' });

    expect(getEffectiveStatus(step, instance, [exec])).toBe('completed');
  });

  it('returns "awaiting_approval" when exec is running but instance paused awaiting_agent_approval', () => {
    const step = makeStep();
    const instance = makeInstance({ status: 'paused', pauseReason: 'awaiting_agent_approval', currentStepId: 'step-1' });
    const exec = makeExec({ status: 'running', completedAt: null });

    expect(getEffectiveStatus(step, instance, [exec])).toBe('awaiting_approval');
  });

  it('returns "running" when exec running and instance running', () => {
    const step = makeStep();
    const instance = makeInstance({ status: 'running', currentStepId: 'step-1' });
    const exec = makeExec({ status: 'running', completedAt: null });

    expect(getEffectiveStatus(step, instance, [exec])).toBe('running');
  });

  it('returns "pending" when no exec and instance not on this step', () => {
    const step = makeStep({ id: 'step-2' });
    const instance = makeInstance({ currentStepId: 'step-1' });

    expect(getEffectiveStatus(step, instance, [])).toBe('pending');
  });
});
