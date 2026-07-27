import {
  WebhookTriggerConfigSchema,
  type InMemoryTriggerRepository,
  type WebhookTriggerConfig,
} from '@mediforce/platform-core';

/**
 * Seed an enabled `webhook` trigger row into a trigger repo so the WebhookRouter
 * can resolve it. The webhook descriptor is supplied explicitly because
 * definitions are trigger-free.
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
