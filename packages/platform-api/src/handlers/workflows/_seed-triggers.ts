import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WebhookTriggerConfigSchema } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';

/** Canonical name of the per-workflow manual trigger singleton. */
export const MANUAL_TRIGGER_NAME = 'manual';

/**
 * `manual` is reserved for the hand-start singleton. A definition that declares
 * a cron/webhook trigger literally named `manual` would collide with the
 * singleton's primary key, so remap it to a type-suffixed name. Cron fires by
 * `type` and a webhook resolves by config path — neither uses the trigger name
 * — so only the label changes. Mirrors migrations 0037/0038.
 */
function reservedSafeName(declaredName: string, suffix: 'cron' | 'webhook'): string {
  return declaredName === MANUAL_TRIGGER_NAME ? `${MANUAL_TRIGGER_NAME}-${suffix}` : declaredName;
}

/**
 * Seed detached Trigger rows (ADR-0011) for a workflow. Shared by every
 * workflow-create path (register, import via register, copy) so triggers are
 * established regardless of how the definition first landed.
 *
 * - **Manual** is a per-workflow singleton, **independent of the definition**
 *   (Issue #930): every workflow gets exactly one enabled `manual` row named
 *   `manual`, created only if the workflow has no manual row yet. Hand-start is
 *   gated on it, and it can be stopped/started but never removed.
 * - **Cron** rows are seeded per declared cron trigger, if absent. The fire
 *   cursor anchors to `now` so a fresh schedule starts at its next slot rather
 *   than back-firing; the declared schedule is advisory after first creation.
 * - **Webhook** rows are seeded per declared webhook trigger, if absent
 *   (Issue #931). Opt-in: only declared webhooks are backfilled, never
 *   auto-seeded. The declared method+path is advisory after first creation.
 */
export async function seedTriggersFromDefinition(
  scope: CallerScope,
  namespace: string,
  definition: Pick<WorkflowDefinition, 'name' | 'triggers'>,
): Promise<void> {
  const existing = await scope.triggers.listByWorkflow(namespace, definition.name);

  // Manual singleton — never derived from `definition.triggers`.
  if (!existing.some((t) => t.type === 'manual')) {
    const seededAt = new Date().toISOString();
    await scope.triggers.create({
      type: 'manual',
      namespace,
      workflowName: definition.name,
      name: MANUAL_TRIGGER_NAME,
      enabled: true,
      config: {},
      lastTriggeredAt: null,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
  }

  // Cron — one row per declared cron schedule, seed-if-absent.
  for (const trigger of definition.triggers) {
    if (
      trigger.type !== 'cron' ||
      typeof trigger.schedule !== 'string' ||
      trigger.schedule.length === 0
    ) {
      continue;
    }
    const name = reservedSafeName(trigger.name, 'cron');
    if (existing.some((t) => t.name === name)) continue;
    const seededAt = new Date().toISOString();
    await scope.triggers.create({
      type: 'cron',
      namespace,
      workflowName: definition.name,
      name,
      enabled: true,
      config: { schedule: trigger.schedule },
      lastTriggeredAt: seededAt,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
  }

  // Webhook — one row per declared webhook trigger, seed-if-absent. The
  // endpoint resolves against these rows, not the definition (Issue #931).
  for (const trigger of definition.triggers) {
    if (trigger.type !== 'webhook') continue;
    const config = WebhookTriggerConfigSchema.safeParse(trigger.config);
    if (!config.success) continue;
    const name = reservedSafeName(trigger.name, 'webhook');
    if (existing.some((t) => t.name === name)) continue;
    const seededAt = new Date().toISOString();
    await scope.triggers.create({
      type: 'webhook',
      namespace,
      workflowName: definition.name,
      name,
      enabled: true,
      config: config.data,
      lastTriggeredAt: null,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
  }
}
