import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessDefinition,
  buildProcessInstance,
  buildStepExecution,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getProcessSteps } from '../get-process-steps.js';
import { NotFoundError } from '../../../errors.js';

/**
 * Behaviour tests for the derived step view. The algorithm is 1:1 with the
 * pre-migration Next.js route — these tests lock in the status-derivation
 * rules across the common shapes (running, past, future, completed).
 */

describe('getProcessSteps handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let processRepo: InMemoryProcessRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    processRepo = new InMemoryProcessRepository();
    // Shared definition used by most tests — three non-terminal steps.
    await processRepo.saveProcessDefinition(
      buildProcessDefinition({
        name: 'demo',
        version: '1.0',
        steps: [
          { id: 's1', name: 'First', type: 'creation' },
          { id: 's2', name: 'Second', type: 'review' },
          { id: 's3', name: 'Third', type: 'terminal' },
        ],
      }),
    );
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    await expect(
      getProcessSteps({ instanceId: 'missing' }, { instanceRepo, processRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the definition is missing', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'unknown-def',
        definitionVersion: '1.0',
        currentStepId: 's1',
      }),
    );

    await expect(
      getProcessSteps({ instanceId: 'inst-1' }, { instanceRepo, processRepo }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('skips terminal steps in the output', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1.0',
        currentStepId: 's1',
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
    );

    expect(result.steps.map((s) => s.stepId)).toEqual(['s1', 's2']);
  });

  it('marks the current step as running and future steps as pending', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1.0',
        currentStepId: 's1',
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
    );

    expect(result.steps.find((s) => s.stepId === 's1')?.status).toBe('running');
    expect(result.steps.find((s) => s.stepId === 's2')?.status).toBe('pending');
  });

  it('marks past steps with execution output as completed', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1.0',
        currentStepId: 's2',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-1',
      buildStepExecution({ instanceId: 'inst-1', stepId: 's1', output: { done: true } }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
    );

    expect(result.steps.find((s) => s.stepId === 's1')?.status).toBe('completed');
    expect(result.steps.find((s) => s.stepId === 's2')?.status).toBe('running');
  });

  it('returns header metadata copied from the instance', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-42',
        definitionName: 'demo',
        definitionVersion: '1.0',
        status: 'paused',
        currentStepId: 's1',
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-42' },
      { instanceRepo, processRepo },
    );

    expect(result).toMatchObject({
      instanceId: 'inst-42',
      definitionName: 'demo',
      definitionVersion: '1.0',
      instanceStatus: 'paused',
      currentStepId: 's1',
    });
  });
});
