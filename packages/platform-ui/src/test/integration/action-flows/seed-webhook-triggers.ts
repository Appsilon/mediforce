import {
  WebhookTriggerConfigSchema,
  type InMemoryTriggerRepository,
  type WorkflowDefinition,
} from '@mediforce/platform-core';

/**
 * Seed enabled `webhook` trigger rows from a definition's declared webhook
 * triggers into a trigger repo, so the WebhookRouter — which now resolves
 * detached table rows, not `definition.triggers` (Issue #931) — matches them.
 * Mirrors the production `seedTriggersFromDefinition` webhook branch.
 */
export async function seedWebhookTriggers(
  triggerRepo: InMemoryTriggerRepository,
  definition: WorkflowDefinition,
): Promise<void> {
  const now = new Date().toISOString();
  for (const trigger of definition.triggers) {
    if (trigger.type !== 'webhook') continue;
    const config = WebhookTriggerConfigSchema.safeParse(trigger.config);
    if (!config.success) continue;
    await triggerRepo.create({
      type: 'webhook',
      namespace: definition.namespace,
      workflowName: definition.name,
      name: trigger.name,
      enabled: true,
      config: config.data,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}
