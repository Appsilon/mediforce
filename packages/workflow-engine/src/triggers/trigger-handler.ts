import type { ManualTrigger } from './manual-trigger.js';
import type { WebhookTrigger } from './webhook-trigger.js';
import type { TriggerContext, TriggerResult } from './trigger-types.js';

/**
 * TriggerHandler: dispatches to the correct trigger implementation
 * based on trigger type.
 */
export class TriggerHandler {
  constructor(
    private readonly manual: ManualTrigger,
    private readonly webhook: WebhookTrigger,
  ) {}

  async fire(
    triggerType: 'manual' | 'webhook',
    context: TriggerContext,
  ): Promise<TriggerResult> {
    if (triggerType === 'manual') return this.manual.fire(context);
    if (triggerType === 'webhook') return this.webhook.fire(context);
    throw new Error(`Unknown trigger type: ${triggerType}`);
  }
}
