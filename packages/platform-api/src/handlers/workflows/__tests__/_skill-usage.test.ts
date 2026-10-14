import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition, WorkflowDefinitionGroup } from '@mediforce/platform-core';
import { findWorkflowSkillUsage } from '../_skill-usage';

function group(version: number, steps: Array<Record<string, unknown>>, defaultVersion: number | null = null) {
  const definition = {
    name: 'wf',
    namespace: 'acme',
    version,
    visibility: 'private',
    steps,
  } as unknown as WorkflowDefinition;
  return { namespace: 'acme', name: 'wf', versions: [definition], latestVersion: version, defaultVersion } as WorkflowDefinitionGroup;
}

describe('findWorkflowSkillUsage', () => {
  it('collects step-level skills and referenced agents of the runnable version', () => {
    const usages = findWorkflowSkillUsage([
      group(1, [
        { id: 'a', agent: { skills: [{ namespace: 'acme', id: 'draft' }] } },
        { id: 'b', agentId: 'reviewer' },
      ]),
    ]);
    expect(usages).toHaveLength(1);
    expect(usages[0].directSkills).toEqual([{ namespace: 'acme', id: 'draft' }]);
    expect(usages[0].agentIds).toEqual(['reviewer']);
  });

  it('skips a workflow that uses neither', () => {
    expect(findWorkflowSkillUsage([group(1, [{ id: 'a' }])])).toEqual([]);
  });
});
