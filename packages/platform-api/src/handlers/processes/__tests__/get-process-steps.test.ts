import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
  buildStepExecution,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getProcessSteps } from '../get-process-steps';
import { NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

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
    const scope = createTestScope({ instanceRepo, processRepo });
    await expect(getProcessSteps({ instanceId: 'missing' }, scope)).rejects.toThrow(NotFoundError);
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
    const scope = createTestScope({ instanceRepo, processRepo });
    await expect(getProcessSteps({ instanceId: 'inst-1' }, scope)).rejects.toThrow(NotFoundError);
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
    const scope = createTestScope({ instanceRepo, processRepo });
    await expect(getProcessSteps({ instanceId: 'inst-1' }, scope)).rejects.toThrow(NotFoundError);
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

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-1' }, scope);

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

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-1' }, scope);

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

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-1' }, scope);

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

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-42' }, scope);

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

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-1' }, scope);

    const s1 = result.steps.find((s) => s.stepId === 's1');
    expect(s1?.executorType).toBe('human');
    expect(s1?.status).toBe('completed');
    expect(s1?.output).toEqual({ decision: 'approve', notes: 'looks good' });
    expect(s1?.executions).toEqual([]);
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

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-1' }, scope);

    expect(result.steps.find((s) => s.stepId === 's1')?.status).toBe('completed');
    expect(result.steps.find((s) => s.stepId === 's2')?.status).toBe('completed');
  });

  it('returns all iterations for a step that ran multiple times in a loop', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-loop',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );
    const firstVisit = buildStepExecution({
      instanceId: 'inst-loop',
      stepId: 's2',
      iterationNumber: 0,
      startedAt: new Date('2024-01-01T10:00:00Z').toISOString(),
      status: 'completed',
      output: { ok: true },
    });
    const secondVisit = buildStepExecution({
      instanceId: 'inst-loop',
      stepId: 's2',
      iterationNumber: 1,
      startedAt: new Date('2024-01-01T11:00:00Z').toISOString(),
      status: 'completed',
      output: { ok: true },
    });
    await instanceRepo.addStepExecution('inst-loop', firstVisit);
    await instanceRepo.addStepExecution('inst-loop', secondVisit);

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-loop' }, scope);

    const s2 = result.steps.find((s) => s.stepId === 's2');
    expect(s2?.executions).toHaveLength(2);
    expect(s2?.executions.map((e) => e.iterationNumber).sort()).toEqual([0, 1]);
    expect(s2?.status).toBe('completed');
  });

  it('marks a step completed when it ran before currentStepId in a loop even if defined after it', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'looping',
        version: 1,
        namespace: 'team-alpha',
        steps: [
          { id: 'gate', name: 'Gate', type: 'decision', executor: 'human' },
          { id: 'wait', name: 'Wait', type: 'creation', executor: 'action' },
        ],
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-loop2',
        definitionName: 'looping',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 'gate',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-loop2',
      buildStepExecution({
        instanceId: 'inst-loop2',
        stepId: 'wait',
        iterationNumber: 0,
        status: 'completed',
        output: { resumeReason: 'deadline_reached' },
      }),
    );

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getProcessSteps({ instanceId: 'inst-loop2' }, scope);

    expect(result.steps.find((s) => s.stepId === 'gate')?.status).toBe('running');
    expect(result.steps.find((s) => s.stepId === 'wait')?.status).toBe('completed');
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
    const scope = createTestScope({
      instanceRepo,
      processRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await getProcessSteps({ instanceId: 'inst-1' }, scope);
    expect(result.steps).toHaveLength(2);
  });

  it('throws NotFoundError (not ForbiddenError) for cross-namespace user callers (anti-enumeration)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: 'team-alpha',
        currentStepId: 's1',
      }),
    );
    const scope = createTestScope({
      instanceRepo,
      processRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    await expect(getProcessSteps({ instanceId: 'inst-1' }, scope)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the instance has no namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-orphan',
        definitionName: 'demo',
        definitionVersion: '1',
        namespace: undefined,
        currentStepId: 's1',
      }),
    );
    const scope = createTestScope({
      instanceRepo,
      processRepo,
      caller: userCaller('u-3', ['team-alpha']),
    });

    await expect(getProcessSteps({ instanceId: 'inst-orphan' }, scope)).rejects.toThrow(NotFoundError);
  });
});
