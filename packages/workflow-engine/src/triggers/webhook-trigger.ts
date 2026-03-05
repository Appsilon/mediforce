import type { z } from 'zod';
import { formatZodErrors } from '@mediforce/platform-core';
import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerContext, TriggerResult } from './trigger-types.js';
import { WebhookPayloadValidationError } from './trigger-errors.js';

/**
 * WebhookTrigger: validates payload with a Zod schema then creates
 * and starts a process instance.
 *
 * Used for event-driven automation where external systems call a webhook
 * to start a new process execution. The schema registry maps trigger names
 * to Zod schemas for payload validation.
 *
 * If no schema is registered for a given trigger name, the payload is
 * accepted without validation (permissive mode).
 */
export class WebhookTrigger {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly schemaRegistry: Map<string, z.ZodType>,
  ) {}

  async fire(context: TriggerContext): Promise<TriggerResult> {
    const schema = this.schemaRegistry.get(context.triggerName);

    if (schema) {
      const result = schema.safeParse(context.payload);
      if (!result.success) {
        const formatted = formatZodErrors(result.error);
        throw new WebhookPayloadValidationError(formatted.split('\n'));
      }
    }

    const instance = await this.engine.createInstance(
      context.definitionName,
      context.definitionVersion,
      context.triggeredBy,
      'webhook',
      context.payload,
      context.configName,
      context.configVersion,
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
