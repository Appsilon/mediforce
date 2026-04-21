import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type { StepExecution, WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine, InvalidTransitionError } from '../index.js';
import type { StepActor } from '../index.js';

const def: WorkflowDefinition = {
  name: 'retry-process',
  version: 1,
  steps: [
    { id: 'upload', name: 'Upload', type: 'creation', executor: 'human' },
    { id: 'deploy', name: 'Deploy', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'upload', to: 'deploy' },
    { from: 'deploy', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
};

const actor: StepActor = { id: 'user-1', role: 'operator' };

async function seedFailedInstance(
  instanceRepo: InMemoryProcessInstanceRepository,
  stepId = 'deploy',
): Promise<string> {
  const now = new Date().toISOString();
  const instance = await instanceRepo.create({
    id: 'instance-1',
    definitionName: 'retry-process',
    definitionVersion: '1',
    status: 'failed',
    currentStepId: stepId,
    variables: { upload: { files: ['adsl.Rds'] } },
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: now,
    updatedAt: now,
    createdBy: 'user-1',
    pauseReason: null,
    error: 'Docker daemon not running',
    assignedRoles: [],
  });
  const exec: StepExecution = {
    id: 'exec-1',
    instanceId: instance.id,
    stepId,
    status: 'failed',
    input: { files: ['adsl.Rds'] },
    output: null,
    verdict: null,
    executedBy: 'agent',
    startedAt: now,
    completedAt: now,
    iterationNumber: 0,
    gateResult: null,
    error: 'Docker daemon not running',
  };
  await instanceRepo.addStepExecution(instance.id, exec);
  return instance.id;
}

describe('WorkflowEngine.retryStep', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    await processRepo.saveWorkflowDefinition(def);
    engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
  });

  it('flips status back to running and clears error so the auto-runner can re-enter the step', async () => {
    const instanceId = await seedFailedInstance(instanceRepo);

    const result = await engine.retryStep(instanceId, 'deploy', actor);

    expect(result.status).toBe('running');
    expect(result.error).toBeNull();
    expect(result.currentStepId).toBe('deploy');
  });

  it('preserves variables from previous steps on retry', async () => {
    const instanceId = await seedFailedInstance(instanceRepo);

    const result = await engine.retryStep(instanceId, 'deploy', actor);

    expect(result.variables).toEqual({ upload: { files: ['adsl.Rds'] } });
  });

  it('emits a step.retried audit event', async () => {
    const instanceId = await seedFailedInstance(instanceRepo);

    await engine.retryStep(instanceId, 'deploy', actor);

    const events = auditRepo.getAll().filter((e) => e.action === 'step.retried');
    expect(events).toHaveLength(1);
    expect(events[0].entityType).toBe('stepExecution');
    expect(events[0].entityId).toBe('exec-1');
    expect(events[0].inputSnapshot).toMatchObject({ stepId: 'deploy' });
    expect(events[0].processInstanceId).toBe(instanceId);
    expect(events[0].actorId).toBe('user-1');
  });

  it('refuses to retry when the instance is running or completed', async () => {
    const instanceId = await seedFailedInstance(instanceRepo);
    await instanceRepo.update(instanceId, { status: 'running' });

    await expect(engine.retryStep(instanceId, 'deploy', actor)).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  it.each([
    ['step_failure'],
    ['routing_error'],
    ['agent_escalated'],
    ['agent_paused'],
  ])('also works when the instance was paused with pauseReason=%s', async (pauseReason) => {
    const instanceId = await seedFailedInstance(instanceRepo);
    await instanceRepo.update(instanceId, { status: 'paused', pauseReason });

    const result = await engine.retryStep(instanceId, 'deploy', actor);

    expect(result.status).toBe('running');
    expect(result.pauseReason).toBeNull();
  });

  it.each([
    ['waiting_for_human'],
    ['missing_env'],
    ['cowork_in_progress'],
    ['awaiting_agent_approval'],
    ['max_iterations_exceeded'],
  ])('refuses to retry when paused for non-failure reason: %s', async (pauseReason) => {
    const instanceId = await seedFailedInstance(instanceRepo);
    await instanceRepo.update(instanceId, { status: 'paused', pauseReason });

    await expect(engine.retryStep(instanceId, 'deploy', actor)).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  it('refuses to retry a step that is not the current step', async () => {
    const instanceId = await seedFailedInstance(instanceRepo, 'deploy');

    await expect(engine.retryStep(instanceId, 'upload', actor)).rejects.toThrow(
      InvalidTransitionError,
    );
    await expect(engine.retryStep(instanceId, 'upload', actor)).rejects.toThrow(
      /not the current step/i,
    );
  });

  it('refuses to retry when the latest execution for that step did not fail', async () => {
    const instanceId = await seedFailedInstance(instanceRepo);
    const executions = await instanceRepo.getStepExecutions(instanceId);
    await instanceRepo.updateStepExecution(instanceId, executions[0].id, {
      status: 'completed',
    });

    await expect(engine.retryStep(instanceId, 'deploy', actor)).rejects.toThrow(
      InvalidTransitionError,
    );
    await expect(engine.retryStep(instanceId, 'deploy', actor)).rejects.toThrow(
      /latest execution.*not failed/i,
    );
  });

});
