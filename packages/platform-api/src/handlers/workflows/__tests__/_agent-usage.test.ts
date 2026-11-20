import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition, WorkflowDefinitionGroup } from '@mediforce/platform-core';
import { findWorkflowAgentUsage } from '../_agent-usage';

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

describe('findWorkflowAgentUsage', () => {
  it('collects the steps of the runnable version that name the agent, with their pinned version', () => {
    const usages = findWorkflowAgentUsage(
      [group(1, [
        { id: 'deploy', agentId: 'a1', agentVersion: 2 },
        { id: 'review', agentId: 'a1' },
        { id: 'other', agentId: 'a2' },
      ])],
      'a1',
    );
    expect(usages).toHaveLength(1);
    expect(usages[0].steps).toEqual([
      { stepId: 'deploy', pinnedVersion: 2 },
      { stepId: 'review', pinnedVersion: null },
    ]);
  });

  it('skips a workflow whose runnable version does not name the agent', () => {
    expect(findWorkflowAgentUsage([group(1, [{ id: 'a', agentId: 'a2' }])], 'a1')).toEqual([]);
  });
});
