import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import {
  WorkflowEngine,
  WebhookTrigger,
  WebhookPayloadValidationError,
} from '../index.js';
import type { WorkflowTriggerContext } from '../index.js';

const webhookDef: WorkflowDefinition = {
  name: 'webhook-process',
  version: 1,
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    { id: 'process', name: 'Process', type: 'creation', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'process' },
    { from: 'process', to: 'done' },
  ],
  triggers: [
    {
      type: 'webhook',
      name: 'incoming-webhook',
      config: { description: 'Webhook trigger for testing' },
    },
  ],
};

const payloadSchema = z.object({
  eventType: z.string(),
  data: z.object({
    id: z.string(),
    value: z.number(),
  }),
});

describe('WebhookTrigger', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let engine: WorkflowEngine;
  let schemaRegistry: Map<string, z.ZodType>;
  let trigger: WebhookTrigger;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
    );
    schemaRegistry = new Map();
    trigger = new WebhookTrigger(engine, schemaRegistry);

    await processRepo.saveWorkflowDefinition(webhookDef);
  });

  function makeContext(
    overrides: Partial<WorkflowTriggerContext> = {},
  ): WorkflowTriggerContext {
    return {
      definitionName: 'webhook-process',
      definitionVersion: 1,
      triggerName: 'incoming-webhook',
      triggeredBy: 'system-webhook',
      payload: {
        eventType: 'order.created',
        data: { id: 'order-123', value: 42 },
      },
      ...overrides,
    };
  }

  it('fireWorkflow() with no schema registered: creates instance (permissive)', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    expect(result.instanceId).toBeDefined();
    expect(result.status).toBe('created');

    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance).toBeDefined();
  });

  it('fireWorkflow() with valid schema + valid payload: creates instance', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const result = await trigger.fireWorkflow(makeContext());
    expect(result.instanceId).toBeDefined();

    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance).toBeDefined();
    expect(instance!.status).toBe('running');
  });

  it('fireWorkflow() with valid schema + invalid payload: throws WebhookPayloadValidationError, instance NOT created', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const invalidContext = makeContext({
      payload: { eventType: 123, wrong: 'field' },
    });

    await expect(trigger.fireWorkflow(invalidContext)).rejects.toThrow(
      WebhookPayloadValidationError,
    );

    // Verify no instance was created
    const allInstances = await instanceRepo.getByDefinition(
      'webhook-process',
      '1',
    );
    expect(allInstances).toHaveLength(0);
  });

  it('WebhookPayloadValidationError message includes field names that failed', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const invalidContext = makeContext({
      payload: { eventType: 123 },
    });

    try {
      await trigger.fireWorkflow(invalidContext);
      expect.fail('Should have thrown WebhookPayloadValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookPayloadValidationError);
      const validationErr = err as WebhookPayloadValidationError;
      const errorText = validationErr.errors.join(' ');
      expect(errorText.length).toBeGreaterThan(0);
    }
  });

  it('fireWorkflow() with valid schema + empty payload when fields required: throws WebhookPayloadValidationError', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const emptyContext = makeContext({ payload: {} });

    await expect(trigger.fireWorkflow(emptyContext)).rejects.toThrow(
      WebhookPayloadValidationError,
    );
  });

  it('fireWorkflow() creates instance with running status', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.status).toBe('running');
  });

  it('fireWorkflow() stores payload in instance.triggerPayload', async () => {
    const payload = {
      eventType: 'order.created',
      data: { id: 'order-456', value: 99 },
    };
    const result = await trigger.fireWorkflow(makeContext({ payload }));
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.triggerPayload).toEqual(payload);
  });

  it('fireWorkflow() sets instance.triggerType to webhook', async () => {
    const result = await trigger.fireWorkflow(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.triggerType).toBe('webhook');
  });
});
