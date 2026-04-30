import { describe, it, expect } from 'vitest';
import { resolveDefinitionSteps } from '../resolve-definition-steps';
import type { ProcessInstance, WorkflowDefinition } from '@mediforce/platform-core';

const workflowStep = (id: string) => ({ id, name: id, type: 'creation' as const, executor: 'human' as const });

const makeWorkflow = (version: number, stepIds: string[]): WorkflowDefinition => ({
  name: 'test',
  version,
  namespace: 'test',
  steps: stepIds.map(workflowStep),
  transitions: [],
  triggers: [{ type: 'manual', name: 'start' }],
});

const makeInstance = (definitionVersion: string): ProcessInstance => ({
  id: 'inst-1',
  definitionName: 'test',
  definitionVersion,
  status: 'running',
  currentStepId: 'step-1',
  variables: {},
  triggerType: 'manual',
  triggerPayload: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdBy: 'user',
  pauseReason: null,
  error: null,
  assignedRoles: [],
});

describe('resolveDefinitionSteps', () => {
  it('[DATA] returns empty array when instance is null', () => {
    expect(resolveDefinitionSteps(null, [])).toEqual([]);
  });

  it('[DATA] resolves from workflowDefinitions when version matches', () => {
    const instance = makeInstance('1');
    const workflow = [makeWorkflow(1, ['wf-step-1', 'wf-step-2', 'wf-step-3'])];
    const result = resolveDefinitionSteps(instance, workflow);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('wf-step-1');
  });

  it('[DATA] returns latest workflow as fallback when version does not match', () => {
    const instance = makeInstance('999');
    const workflow = [makeWorkflow(1, ['wf-fallback'])];
    const result = resolveDefinitionSteps(instance, workflow);
    expect(result[0].id).toBe('wf-fallback');
  });

  it('[DATA] returns empty when no definitions exist at all', () => {
    const instance = makeInstance('1');
    expect(resolveDefinitionSteps(instance, [])).toEqual([]);
  });

  it('[DATA] handles definitionVersion that is not a valid number', () => {
    const instance = makeInstance('v1.0.0-beta');
    const workflow = [makeWorkflow(1, ['wf-step'])];
    // parseInt('v1.0.0-beta') is NaN -> skip match -> fall back to latest
    const result = resolveDefinitionSteps(instance, workflow);
    expect(result[0].id).toBe('wf-step'); // last resort fallback
  });
});
