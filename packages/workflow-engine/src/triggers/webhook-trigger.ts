import type { z } from 'zod';
import { formatZodErrors } from '@mediforce/platform-core';
import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerResult, WorkflowTriggerContext } from './trigger-types.js';
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

  /**
   * Validates payload and creates a workflow instance from a unified WorkflowDefinition.
   * No separate ProcessConfig required — all config is embedded in the definition.
   */
  async fireWorkflow(context: WorkflowTriggerContext): Promise<TriggerResult> {
    const schema = this.schemaRegistry.get(context.triggerName);

    if (schema) {
      const result = schema.safeParse(context.payload ?? {});
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
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
