import type { WorkflowDefinition } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';

/** Canonical name of the per-workflow manual trigger singleton. */
export const MANUAL_TRIGGER_NAME = 'manual';

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
    if (existing.some((t) => t.name === trigger.name)) continue;
    const seededAt = new Date().toISOString();
    await scope.triggers.create({
      type: 'cron',
      namespace,
      workflowName: definition.name,
      name: trigger.name,
      enabled: true,
      config: { schedule: trigger.schedule },
      lastTriggeredAt: seededAt,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
  }
}
