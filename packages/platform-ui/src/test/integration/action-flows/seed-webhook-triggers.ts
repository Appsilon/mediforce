import {
  WebhookTriggerConfigSchema,
  type InMemoryTriggerRepository,
  type WebhookTriggerConfig,
} from '@mediforce/platform-core';

/**
 * Seed an enabled `webhook` trigger row into a trigger repo, so the
 * WebhookRouter — which resolves detached table rows, not `definition.triggers`
 * (Issue #931, #932) — matches it. Definitions are trigger-free, so the webhook
 * descriptor is supplied explicitly rather than read from the definition.
 */
export async function seedWebhookTrigger(
  triggerRepo: InMemoryTriggerRepository,
  webhook: {
    namespace: string;
    workflowName: string;
    name: string;
    config: WebhookTriggerConfig;
  },
): Promise<void> {
  const config = WebhookTriggerConfigSchema.parse(webhook.config);
  const now = new Date().toISOString();
  await triggerRepo.create({
    type: 'webhook',
    namespace: webhook.namespace,
    workflowName: webhook.workflowName,
    name: webhook.name,
    enabled: true,
    config,
    lastTriggeredAt: null,
    createdAt: now,
    updatedAt: now,
  });
}
