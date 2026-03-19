import { describe, it, expect } from 'vitest';
import { resolveDefinitionSteps } from '../resolve-definition-steps';
import type { ProcessInstance, WorkflowDefinition } from '@mediforce/platform-core';

const legacyStep = (id: string) => ({ id, name: id, type: 'creation' as const });
const workflowStep = (id: string) => ({ id, name: id, type: 'creation' as const, executor: 'human' as const });

const makeLegacy = (version: string, stepIds: string[]) => ({
  version,
  steps: stepIds.map(legacyStep),
});

const makeWorkflow = (version: number, stepIds: string[]): WorkflowDefinition => ({
  name: 'test',
  version,
  steps: stepIds.map(workflowStep),
  transitions: [],
  triggers: [{ type: 'manual', name: 'start' }],
});

const makeInstance = (definitionVersion: string, configName?: string): ProcessInstance => ({
  id: 'inst-1',
  definitionName: 'test',
  definitionVersion,
  configName,
  configVersion: configName ? '1' : undefined,
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
    expect(resolveDefinitionSteps(null, [], [])).toEqual([]);
  });

  it('[DATA] resolves from legacy processDefinitions when version matches', () => {
    const instance = makeInstance('1.0.0', 'all-human');
    const legacy = [makeLegacy('1.0.0', ['step-a', 'step-b'])];
    const result = resolveDefinitionSteps(instance, legacy, []);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('step-a');
  });

  it('[DATA] resolves from workflowDefinitions when no legacy match', () => {
    const instance = makeInstance('1'); // new-style, no configName
    const workflow = [makeWorkflow(1, ['wf-step-1', 'wf-step-2', 'wf-step-3'])];
    const result = resolveDefinitionSteps(instance, [], workflow);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('wf-step-1');
  });

  it('[DATA] prefers legacy when both sources have matching versions', () => {
    const instance = makeInstance('1', 'config');
    const legacy = [makeLegacy('1', ['legacy-step'])];
    const workflow = [makeWorkflow(1, ['wf-step'])];
    const result = resolveDefinitionSteps(instance, legacy, workflow);
    expect(result[0].id).toBe('legacy-step');
  });

  it('[DATA] falls back to workflow when legacy version does not match', () => {
    const instance = makeInstance('2');
    const legacy = [makeLegacy('1.0.0', ['old-step'])];
    const workflow = [makeWorkflow(2, ['new-step'])];
    const result = resolveDefinitionSteps(instance, legacy, workflow);
    expect(result[0].id).toBe('new-step');
  });

  it('[DATA] last resort: returns latest legacy when nothing matches', () => {
    const instance = makeInstance('999');
    const legacy = [makeLegacy('1.0.0', ['fallback-step'])];
    const result = resolveDefinitionSteps(instance, legacy, []);
    expect(result[0].id).toBe('fallback-step');
  });

  it('[DATA] last resort: returns latest workflow when nothing matches and no legacy', () => {
    const instance = makeInstance('999');
    const workflow = [makeWorkflow(1, ['wf-fallback'])];
    const result = resolveDefinitionSteps(instance, [], workflow);
    expect(result[0].id).toBe('wf-fallback');
  });

  it('[DATA] returns empty when no definitions exist at all', () => {
    const instance = makeInstance('1');
    expect(resolveDefinitionSteps(instance, [], [])).toEqual([]);
  });

  it('[DATA] handles definitionVersion that is not a valid number for workflow lookup', () => {
    const instance = makeInstance('v1.0.0-beta');
    const workflow = [makeWorkflow(1, ['wf-step'])];
    // parseInt('v1.0.0-beta') is NaN → skip workflow match → fall back to latest
    const result = resolveDefinitionSteps(instance, [], workflow);
    expect(result[0].id).toBe('wf-step'); // last resort fallback
  });
});
