import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  InMemoryProcessRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createProcess } from '../create-process.js';
import { NotFoundError } from '../../../errors.js';
import type { ManualTriggerLike } from '../create-process.js';

function stubTrigger(
  result = { instanceId: 'inst-new', status: 'created' as const },
): ManualTriggerLike & { fireWorkflow: ReturnType<typeof vi.fn> } {
  return {
    fireWorkflow: vi.fn().mockResolvedValue(result),
  };
}

describe('createProcess handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
  });

  it('starts a process at the requested version and returns the instance id', async () => {
    const manualTrigger = stubTrigger();

    const result = await createProcess(
      {
        definitionName: 'wf-a',
        definitionVersion: 3,
        triggeredBy: 'alice',
      },
      { manualTrigger, processRepo },
    );

    expect(result.instanceId).toBe('inst-new');
    expect(manualTrigger.fireWorkflow).toHaveBeenCalledWith({
      definitionName: 'wf-a',
      definitionVersion: 3,
      triggerName: 'manual',
      triggeredBy: 'alice',
      payload: {},
    });
  });

  it('falls back to the latest version when none provided', async () => {
    await processRepo.saveWorkflowDefinition({
      name: 'wf-a',
      version: 7,
      steps: [],
      transitions: [],
      variables: [],
      triggers: [],
      permissions: { roles: [] },
      metadata: { description: 'wf-a' },
    } as never);

    const manualTrigger = stubTrigger();
    await createProcess(
      { definitionName: 'wf-a', triggeredBy: 'alice' },
      { manualTrigger, processRepo },
    );

    expect(manualTrigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ definitionVersion: 7 }),
    );
  });

  it('throws NotFoundError when no workflow versions exist and none was provided', async () => {
    await expect(
      createProcess(
        { definitionName: 'wf-missing', triggeredBy: 'alice' },
        { manualTrigger: stubTrigger(), processRepo },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('fires triggerRun after the instance is created when provided', async () => {
    const triggerRun = vi.fn();
    await createProcess(
      { definitionName: 'wf-a', definitionVersion: 1, triggeredBy: 'alice' },
      { manualTrigger: stubTrigger(), processRepo, triggerRun },
    );
    expect(triggerRun).toHaveBeenCalledWith('inst-new', 'alice');
  });
});
