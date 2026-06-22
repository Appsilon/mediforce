import type { ManualTrigger } from './manual-trigger';
import type { WebhookTrigger } from './webhook-trigger';
import type { CronTrigger } from './cron-trigger';
import type { WorkflowTriggerContext, TriggerResult } from './trigger-types';

/**
 * TriggerHandler: dispatches to the correct trigger implementation
 * based on trigger type.
 */
export class TriggerHandler {
  constructor(
    private readonly manual: ManualTrigger,
    private readonly webhook: WebhookTrigger,
    private readonly cron?: CronTrigger,
  ) {}

  async fire(triggerType: 'manual' | 'webhook' | 'cron', context: WorkflowTriggerContext): Promise<TriggerResult> {
    if (triggerType === 'manual') return this.manual.fireWorkflow(context);
    if (triggerType === 'webhook') return this.webhook.fireWorkflow(context);
    if (triggerType === 'cron') {
      if (!this.cron) throw new Error('CronTrigger not configured');
      return this.cron.fireWorkflow(context);
    }
    throw new Error(`Unknown trigger type: ${triggerType}`);
  }
}
