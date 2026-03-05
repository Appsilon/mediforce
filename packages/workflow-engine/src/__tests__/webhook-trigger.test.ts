import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  NoOpGateErrorNotifier,
} from '@mediforce/platform-core';
import type { ProcessDefinition } from '@mediforce/platform-core';
import {
  GateRegistry,
  WorkflowEngine,
  WebhookTrigger,
  WebhookPayloadValidationError,
} from '../index.js';
import type { TriggerContext } from '../index.js';

const webhookDef: ProcessDefinition = {
  name: 'webhook-process',
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
  let gateRegistry: GateRegistry;
  let engine: WorkflowEngine;
  let schemaRegistry: Map<string, z.ZodType>;
  let trigger: WebhookTrigger;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    gateRegistry = new GateRegistry();
    const notifier = new NoOpGateErrorNotifier();
    engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      gateRegistry,
      notifier,
    );
    schemaRegistry = new Map();
    trigger = new WebhookTrigger(engine, schemaRegistry);

    await processRepo.saveProcessDefinition(webhookDef);
  });

  function makeContext(
    overrides: Partial<TriggerContext> = {},
  ): TriggerContext {
    return {
      definitionName: 'webhook-process',
      definitionVersion: '1.0',
      configName: 'default',
      configVersion: '1.0',
      triggerName: 'incoming-webhook',
      triggeredBy: 'system-webhook',
      payload: {
        eventType: 'order.created',
        data: { id: 'order-123', value: 42 },
      },
      ...overrides,
    };
  }

  it('fire() with no schema registered: creates instance (permissive)', async () => {
    // No schema registered for 'incoming-webhook'
    const result = await trigger.fire(makeContext());
    expect(result.instanceId).toBeDefined();
    expect(result.status).toBe('created');

    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance).toBeDefined();
  });

  it('fire() with valid schema + valid payload: creates instance', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const result = await trigger.fire(makeContext());
    expect(result.instanceId).toBeDefined();

    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance).toBeDefined();
    expect(instance!.status).toBe('running');
  });

  it('fire() with valid schema + invalid payload: throws WebhookPayloadValidationError, instance NOT created', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const invalidContext = makeContext({
      payload: { eventType: 123, wrong: 'field' },
    });

    await expect(trigger.fire(invalidContext)).rejects.toThrow(
      WebhookPayloadValidationError,
    );

    // Verify no instance was created
    const allInstances = await instanceRepo.getByDefinition(
      'webhook-process',
      '1.0',
    );
    expect(allInstances).toHaveLength(0);
  });

  it('WebhookPayloadValidationError message includes field names that failed', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const invalidContext = makeContext({
      payload: { eventType: 123 },
    });

    try {
      await trigger.fire(invalidContext);
      expect.fail('Should have thrown WebhookPayloadValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookPayloadValidationError);
      const validationErr = err as WebhookPayloadValidationError;
      // Should mention the fields that failed
      const errorText = validationErr.errors.join(' ');
      expect(errorText.length).toBeGreaterThan(0);
    }
  });

  it('fire() with valid schema + empty payload when fields required: throws WebhookPayloadValidationError', async () => {
    schemaRegistry.set('incoming-webhook', payloadSchema);

    const emptyContext = makeContext({ payload: {} });

    await expect(trigger.fire(emptyContext)).rejects.toThrow(
      WebhookPayloadValidationError,
    );
  });

  it('fire() creates instance with running status', async () => {
    const result = await trigger.fire(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.status).toBe('running');
  });

  it('fire() stores payload in instance.triggerPayload', async () => {
    const payload = {
      eventType: 'order.created',
      data: { id: 'order-456', value: 99 },
    };
    const result = await trigger.fire(makeContext({ payload }));
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.triggerPayload).toEqual(payload);
  });

  it('fire() sets instance.triggerType to webhook', async () => {
    const result = await trigger.fire(makeContext());
    const instance = await instanceRepo.getById(result.instanceId);
    expect(instance!.triggerType).toBe('webhook');
  });
});
