import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
  buildStepExecution,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getProcessSteps } from '../get-process-steps.js';
import { NotFoundError, ForbiddenError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

/**
 * Locks in the status-derivation rules across the common shapes (running,
 * past, future, completed) and the namespace gating.
 */

describe('getProcessSteps handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let processRepo: InMemoryProcessRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    processRepo = new InMemoryProcessRepository();
    // Shared definition: three non-terminal steps in `team-alpha`.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'demo',
        version: 1,
        namespace: 'team-alpha',
        steps: [
          { id: 's1', name: 'First', type: 'creation', executor: 'human' },
          { id: 's2', name: 'Second', type: 'review', executor: 'agent' },
          { id: 's3', name: 'Third', type: 'terminal', executor: 'human' },
        ],
      }),
    );
  });

  it('throws NotFoundError when the instance does not exist', async () => {
    await expect(
      getProcessSteps({ instanceId: 'missing' }, { instanceRepo, processRepo }, apiKey),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the workflow definition is missing', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'unknown-def',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );
    await expect(
      getProcessSteps({ instanceId: 'inst-1' }, { instanceRepo, processRepo }, apiKey),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when definitionVersion is not numeric', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: 'not-a-number',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );
    await expect(
      getProcessSteps({ instanceId: 'inst-1' }, { instanceRepo, processRepo }, apiKey),
    ).rejects.toThrow(NotFoundError);
  });

  it('skips terminal steps in the output', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
      apiKey,
    );

    expect(result.steps.map((s) => s.stepId)).toEqual(['s1', 's2']);
  });

  it('marks the current step running and future steps pending', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
      apiKey,
    );

    expect(result.steps.find((s) => s.stepId === 's1')?.status).toBe('running');
    expect(result.steps.find((s) => s.stepId === 's2')?.status).toBe('pending');
  });

  it('marks past steps with execution output as completed', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
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
      apiKey,
    );

    expect(result.steps.find((s) => s.stepId === 's1')?.status).toBe('completed');
    expect(result.steps.find((s) => s.stepId === 's2')?.status).toBe('running');
  });

  it('returns header metadata copied from the instance', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-42',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        status: 'paused',
        currentStepId: 's1',
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-42' },
      { instanceRepo, processRepo },
      apiKey,
    );

    expect(result).toMatchObject({
      instanceId: 'inst-42',
      definitionName: 'demo',
      definitionVersion: '1',
      instanceStatus: 'paused',
      currentStepId: 's1',
    });
  });

  it('reads output from instance.variables for human steps', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's2',
        variables: { s1: { decision: 'approve', notes: 'looks good' } },
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
      apiKey,
    );

    const s1 = result.steps.find((s) => s.stepId === 's1');
    expect(s1?.executorType).toBe('human');
    expect(s1?.status).toBe('completed');
    expect(s1?.output).toEqual({ decision: 'approve', notes: 'looks good' });
    expect(s1?.execution).toBeNull();
  });

  it('marks all reachable steps completed when status=completed and currentStepId=null', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        status: 'completed',
        currentStepId: null,
        variables: { s1: { ok: true }, s2: { ok: true } },
      }),
    );

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
      apiKey,
    );

    expect(result.steps.find((s) => s.stepId === 's1')?.status).toBe('completed');
    expect(result.steps.find((s) => s.stepId === 's2')?.status).toBe('completed');
  });

  it('returns the steps for in-namespace user callers', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const result = await getProcessSteps(
      { instanceId: 'inst-1' },
      { instanceRepo, processRepo },
      user,
    );
    expect(result.steps).toHaveLength(2);
  });

  it('throws ForbiddenError for cross-namespace user callers', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );
    const otherUser: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getProcessSteps({ instanceId: 'inst-1' }, { instanceRepo, processRepo }, otherUser),
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-orphan',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: undefined,
        currentStepId: 's1',
      }),
    );
    const user: CallerIdentity = {
      kind: 'user',
      uid: 'u-3',
      namespaces: new Set(['team-alpha']),
    };

    await expect(
      getProcessSteps({ instanceId: 'inst-orphan' }, { instanceRepo, processRepo }, user),
    ).rejects.toThrow(ForbiddenError);
  });
});
