import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type { ProcessDefinition } from '@mediforce/platform-core';
import {
  WorkflowEngine,
  ManualTrigger,
} from '../index.js';
import type { TriggerContext } from '../index.js';

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

describe('ManualTrigger', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let engine: WorkflowEngine;
  let trigger: ManualTrigger;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
    );
    trigger = new ManualTrigger(engine);

    await processRepo.saveProcessDefinition(linearDef);
  });

  function makeContext(
    overrides: Partial<TriggerContext> = {},
  ): TriggerContext {
    return {
      definitionName: 'linear-process',
      definitionVersion: '1.0',
      configName: 'default',
      configVersion: '1.0',
      triggerName: 'Start Process',
      triggeredBy: 'user-1',
      payload: { key: 'value' },
      ...overrides,
    };
  }

  it('fire() creates an instance and returns instanceId', async () => {
    const result = await trigger.fire(makeContext());
    expect(result.instanceId).toBeDefined();
    expect(result.status).toBe('created');
  });

  it('fire() leaves instance in running state (not created)', async () => {
    const result = await trigger.fire(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.status).toBe('running');
  });

  it('fire() starts the instance at the first step', async () => {
    const result = await trigger.fire(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.currentStepId).toBe('start');
  });

  it('fire() on non-existent definition throws', async () => {
    await expect(
      trigger.fire(makeContext({ definitionName: 'nonexistent' })),
    ).rejects.toThrow();
  });

  it('returned instanceId is a valid UUID', async () => {
    const result = await trigger.fire(makeContext());
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(result.instanceId).toMatch(uuidRegex);
  });
});
