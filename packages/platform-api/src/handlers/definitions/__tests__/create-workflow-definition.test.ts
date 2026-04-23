import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createWorkflowDefinition } from '../create-workflow-definition.js';

function draft(name: string): Record<string, unknown> {
  return {
    name,
    namespace: 'handle',
    steps: [],
    transitions: [],
    variables: [],
    triggers: [],
    permissions: { roles: [] },
    metadata: { description: 'test' },
  };
}

describe('createWorkflowDefinition handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
  });

  it('starts at version 1 for a brand-new workflow', async () => {
    const result = await createWorkflowDefinition(
      { namespace: 'handle', draft: draft('wf-a') as never },
      { processRepo },
    );

    expect(result).toEqual({ success: true, name: 'wf-a', version: 1 });

    const stored = await processRepo.getWorkflowDefinition('wf-a', 1);
    expect(stored).not.toBeNull();
    expect(stored?.namespace).toBe('handle');
  });

  it('increments from the highest existing version', async () => {
    await processRepo.saveWorkflowDefinition(
      { ...draft('wf-a'), version: 3, createdAt: 'x' } as never,
    );
    await processRepo.saveWorkflowDefinition(
      { ...draft('wf-a'), version: 5, createdAt: 'x' } as never,
    );

    const result = await createWorkflowDefinition(
      { namespace: 'handle', draft: draft('wf-a') as never },
      { processRepo },
    );

    expect(result.version).toBe(6);
  });

  it('query-param namespace overrides any namespace in the body', async () => {
    const result = await createWorkflowDefinition(
      {
        namespace: 'handle',
        draft: { ...draft('wf-a'), namespace: 'ignored' } as never,
      },
      { processRepo },
    );
    const stored = await processRepo.getWorkflowDefinition('wf-a', result.version);
    expect(stored?.namespace).toBe('handle');
  });
});
