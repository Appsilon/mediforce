import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type {
  ProcessDefinition,
  ProcessInstance,
} from '@mediforce/platform-core';
import {
  StepExecutor,
  RoutingError,
  InvalidTransitionError,
} from '../index.js';
import type { StepActor } from '../index.js';

const linearDef: ProcessDefinition = {
  name: 'linear-process',
  version: '1.0',
  steps: [
    { id: 'start', name: 'Start', type: 'creation' },
    { id: 'process', name: 'Process', type: 'creation' },
    { id: 'done', name: 'Done', type: 'terminal' },
  ],
  transitions: [
    { from: 'start', to: 'process' },
    { from: 'process', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start Process' }],
};

const branchingDef: ProcessDefinition = {
  name: 'branching-process',
  version: '1.0',
  steps: [
    { id: 'start', name: 'Start', type: 'creation' },
    { id: 'path-a', name: 'Path A', type: 'creation' },
    { id: 'path-b', name: 'Path B', type: 'creation' },
    { id: 'done', name: 'Done', type: 'terminal' },
  ],
  transitions: [
    { from: 'start', to: 'path-a', when: 'output.route == "a"' },
    { from: 'start', to: 'path-b', when: 'output.route == "b"' },
    { from: 'path-a', to: 'done' },
    { from: 'path-b', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start Branching' }],
};

const actor: StepActor = { id: 'user-1', role: 'operator' };

function makeRunningInstance(
  currentStepId: string,
  overrides: Partial<ProcessInstance> = {},
): ProcessInstance {
  return {
    id: 'instance-1',
    definitionName: 'linear-process',
    definitionVersion: '1.0',
    configName: 'default',
    configVersion: '1.0',
    status: 'running',
    currentStepId,
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdBy: 'user-1',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    archived: false,
    ...overrides,
  };
}

describe('StepExecutor', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let executor: StepExecutor;

  beforeEach(() => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    executor = new StepExecutor(instanceRepo, auditRepo);
  });

  it('completes a step without branching: instance moves to next step, StepExecution recorded', async () => {
    const instance = makeRunningInstance('start');
    await instanceRepo.create(instance);

    await executor.executeStep(instance, { result: 'ok' }, actor, linearDef);

    const updated = await instanceRepo.getById('instance-1');
    expect(updated!.currentStepId).toBe('process');
    expect(updated!.status).toBe('running');

    const executions = await instanceRepo.getStepExecutions('instance-1');
    expect(executions.length).toBeGreaterThanOrEqual(1);
    const stepExec = executions.find((e) => e.stepId === 'start');
    expect(stepExec).toBeDefined();
    expect(stepExec!.status).toBe('completed');
  });

  it('records verdict from stepOutput when present', async () => {
    const instance = makeRunningInstance('start');
    await instanceRepo.create(instance);

    await executor.executeStep(
      instance,
      { verdict: 'approve', comment: 'Looks good' },
      actor,
      linearDef,
    );

    const executions = await instanceRepo.getStepExecutions('instance-1');
    const stepExec = executions.find((e) => e.stepId === 'start');
    expect(stepExec!.verdict).toBe('approve');
  });

  it('records verdict as null when stepOutput has no verdict', async () => {
    const instance = makeRunningInstance('start');
    await instanceRepo.create(instance);

    await executor.executeStep(
      instance,
      { result: 'ok' },
      actor,
      linearDef,
    );

    const executions = await instanceRepo.getStepExecutions('instance-1');
    const stepExec = executions.find((e) => e.stepId === 'start');
    expect(stepExec!.verdict).toBeNull();
  });

  it('completes a branching step: when expression routes to correct next step', async () => {
    const instance = makeRunningInstance('start', {
      definitionName: 'branching-process',
    });
    await instanceRepo.create(instance);

    await executor.executeStep(instance, { route: 'b' }, actor, branchingDef);

    const updated = await instanceRepo.getById('instance-1');
    expect(updated!.currentStepId).toBe('path-b');
  });

  it('stores routing result in StepExecution.gateResult', async () => {
    const instance = makeRunningInstance('start', {
      definitionName: 'branching-process',
    });
    await instanceRepo.create(instance);

    await executor.executeStep(instance, { route: 'a' }, actor, branchingDef);

    const executions = await instanceRepo.getStepExecutions('instance-1');
    const stepExec = executions.find((e) => e.stepId === 'start');
    expect(stepExec!.gateResult).toBeDefined();
    expect(stepExec!.gateResult!.next).toBe('path-a');
  });

  it('emits audit event with action step.completed, actor, inputSnapshot, outputSnapshot, basis', async () => {
    const instance = makeRunningInstance('start');
    await instanceRepo.create(instance);

    await executor.executeStep(instance, { data: 'test' }, actor, linearDef);

    const events = auditRepo.getAll();
    const stepEvent = events.find((e) => e.action === 'step.completed');
    expect(stepEvent).toBeDefined();
    expect(stepEvent!.actorId).toBe('user-1');
    expect(stepEvent!.actorRole).toBe('operator');
    expect(stepEvent!.entityType).toBe('processInstance');
    expect(stepEvent!.entityId).toBe('instance-1');
    expect(stepEvent!.processInstanceId).toBe('instance-1');
    expect(stepEvent!.stepId).toBe('start');
    expect(stepEvent!.inputSnapshot).toBeDefined();
    expect(stepEvent!.outputSnapshot).toBeDefined();
    expect(stepEvent!.basis).toBeDefined();
  });

  it('on a terminal step: instance status becomes completed, currentStepId becomes null', async () => {
    const instance = makeRunningInstance('process');
    await instanceRepo.create(instance);

    await executor.executeStep(instance, {}, actor, linearDef);

    // After advancing from 'process', the next step is 'done' (terminal)
    const updated = await instanceRepo.getById('instance-1');
    expect(updated!.status).toBe('completed');
    expect(updated!.currentStepId).toBeNull();
  });

  it('step failure: instance paused, StepExecution status failed, audit action step.failed', async () => {
    const instance = makeRunningInstance('start');
    await instanceRepo.create(instance);

    await executor.failStep(instance, 'start', new Error('Processing failed'), actor);

    const updated = await instanceRepo.getById('instance-1');
    expect(updated!.status).toBe('paused');
    expect(updated!.pauseReason).toBe('step_failure');

    const executions = await instanceRepo.getStepExecutions('instance-1');
    const failedExec = executions.find((e) => e.stepId === 'start' && e.status === 'failed');
    expect(failedExec).toBeDefined();

    const events = auditRepo.getAll();
    const failEvent = events.find((e) => e.action === 'step.failed');
    expect(failEvent).toBeDefined();
  });

  it('no matching when expression: RoutingError thrown, instance paused with pauseReason=routing_error', async () => {
    const instance = makeRunningInstance('start', {
      definitionName: 'branching-process',
    });
    await instanceRepo.create(instance);
    // Output does not match any when expression

    await expect(
      executor.executeStep(instance, { route: 'c' }, actor, branchingDef),
    ).rejects.toThrow(RoutingError);

    const updated = await instanceRepo.getById('instance-1');
    expect(updated!.status).toBe('paused');
    expect(updated!.pauseReason).toBe('routing_error');

    const events = auditRepo.getAll();
    const routingEvent = events.find((e) => e.action === 'routing.error');
    expect(routingEvent).toBeDefined();
  });

  it('attempt to execute on non-running instance: throws InvalidTransitionError', async () => {
    const instance = makeRunningInstance('start', { status: 'paused' });
    await instanceRepo.create(instance);

    await expect(
      executor.executeStep(instance, {}, actor, linearDef),
    ).rejects.toThrow(InvalidTransitionError);

    // No state change
    const updated = await instanceRepo.getById('instance-1');
    expect(updated!.status).toBe('paused');
  });

  it('audit event contains processDefinitionVersion', async () => {
    const instance = makeRunningInstance('start');
    await instanceRepo.create(instance);

    await executor.executeStep(instance, {}, actor, linearDef);

    const events = auditRepo.getAll();
    const stepEvent = events.find((e) => e.action === 'step.completed');
    expect(stepEvent!.processDefinitionVersion).toBe('1.0');
  });
});
