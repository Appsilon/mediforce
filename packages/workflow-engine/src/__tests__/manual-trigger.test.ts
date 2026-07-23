import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryTriggerRepository,
} from '@mediforce/platform-core';
import type { ManualTriggerResource, WorkflowDefinition } from '@mediforce/platform-core';
import {
  WorkflowEngine,
  ManualTrigger,
  ManualTriggerNotDeclaredError,
} from '../index';
import type { WorkflowTriggerContext } from '../index';

const linearDef: WorkflowDefinition = {
  name: 'linear-process',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'process', name: 'Process', type: 'creation', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'process' },
    { from: 'process', to: 'done' },
  ],
  triggers: [{ type: 'manual', name: 'Start Process' }],
};

const cronOnlyDef: WorkflowDefinition = {
  name: 'cron-only-process',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'start', to: 'done' }],
  triggers: [{ type: 'cron', name: 'Nightly', schedule: '0 0 * * *' }],
};

function manualRow(
  namespace: string,
  workflowName: string,
  name: string,
  enabled: boolean,
): ManualTriggerResource {
  const now = new Date().toISOString();
  return {
    type: 'manual',
    namespace,
    workflowName,
    name,
    enabled,
    config: {},
    lastTriggeredAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('ManualTrigger', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let triggerRepo: InMemoryTriggerRepository;
  let engine: WorkflowEngine;
  let trigger: ManualTrigger;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    triggerRepo = new InMemoryTriggerRepository();
    engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
    );
    trigger = new ManualTrigger(engine, processRepo, triggerRepo);

    await processRepo.saveWorkflowDefinition(linearDef);
    await processRepo.saveWorkflowDefinition(cronOnlyDef);
    // The guard reads the unified triggers table (ADR-0011), not the definition's
    // advisory `triggers[]`. `linear-process` gets an enabled manual row;
    // `cron-only-process` gets none.
    await triggerRepo.create(manualRow('test', 'linear-process', 'Start Process', true));
  });

  function makeContext(
    overrides: Partial<WorkflowTriggerContext> = {},
  ): WorkflowTriggerContext {
    return {
      namespace: 'test',
      definitionName: 'linear-process',
      definitionVersion: 1,
      triggerName: 'Start Process',
      triggeredBy: 'user-1',
      payload: { key: 'value' },
      ...overrides,
    };
  }

  it('fireWorkflow() creates an instance and returns instanceId', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    expect(result.instanceId).toBeDefined();
    expect(result.status).toBe('created');
  });

  it('fireWorkflow() leaves instance in running state (not created)', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.status).toBe('running');
  });

  it('fireWorkflow() starts the instance at the first step', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.currentStepId).toBe('start');
  });

  it('fireWorkflow() on non-existent definition throws', async () => {
    await expect(
      trigger.fireWorkflow(makeContext({ definitionName: 'nonexistent' })),
    ).rejects.toThrow();
  });

  it('returned instanceId is a valid UUID', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(result.instanceId).toMatch(uuidRegex);
  });

  describe('manual trigger gating (unified triggers table)', () => {
    it('rejects workflows with no enabled manual trigger row', async () => {
      await expect(
        trigger.fireWorkflow(
          makeContext({ definitionName: 'cron-only-process' }),
        ),
      ).rejects.toThrow(ManualTriggerNotDeclaredError);
    });

    it('rejects when the manual trigger row exists but is disabled', async () => {
      await triggerRepo.update('test', 'linear-process', 'Start Process', {
        enabled: false,
        updatedAt: new Date().toISOString(),
      });
      await expect(trigger.fireWorkflow(makeContext())).rejects.toThrow(
        ManualTriggerNotDeclaredError,
      );
    });

    it('allows starting once a disabled manual row is re-enabled', async () => {
      await triggerRepo.update('test', 'linear-process', 'Start Process', {
        enabled: false,
        updatedAt: new Date().toISOString(),
      });
      await triggerRepo.update('test', 'linear-process', 'Start Process', {
        enabled: true,
        updatedAt: new Date().toISOString(),
      });
      const result = await trigger.fireWorkflow(makeContext());
      expect(result.status).toBe('created');
    });

    it('does not create an instance when manual trigger is missing', async () => {
      try {
        await trigger.fireWorkflow(
          makeContext({ definitionName: 'cron-only-process' }),
        );
      } catch {
        // expected
      }
      const all = await instanceRepo.getByDefinition('cron-only-process', '1');
      expect(all).toHaveLength(0);
    });

    it('error message identifies the workflow and version', async () => {
      await expect(
        trigger.fireWorkflow(
          makeContext({
            definitionName: 'cron-only-process',
            definitionVersion: 1,
          }),
        ),
      ).rejects.toThrow(/cron-only-process.*v1/);
    });
  });
});
