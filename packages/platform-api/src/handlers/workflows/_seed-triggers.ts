import type { CallerScope } from '../../repositories/index';

/** Canonical name of the per-workflow manual trigger singleton. */
export const MANUAL_TRIGGER_NAME = 'manual';

/**
 * Seed the manual trigger singleton (ADR-0011) for a workflow. Shared by every
 * workflow-create path (register, import via register, copy) so hand-start
 * works regardless of how the definition first landed.
 *
 * Manual is a per-workflow singleton, **independent of the definition**
 * (Issue #930): every workflow gets exactly one enabled `manual` row named
 * `manual`, created only if the workflow has no manual row yet. Hand-start is
 * gated on it, and it can be stopped/started but never removed.
 *
 * Cron and webhook triggers are **not** seeded from the definition — since
 * Issue #932 definitions are trigger-free. Those are independent, mutable
 * resources created via `mediforce workflow trigger-*` / the Triggers tab and
 * read from the unified `triggers` table by the heartbeat and webhook router.
 */
export async function seedManualTrigger(
  scope: CallerScope,
  namespace: string,
  workflowName: string,
): Promise<void> {
  const existing = await scope.triggers.listByWorkflow(namespace, workflowName);
  if (existing.some((t) => t.type === 'manual')) return;

  const seededAt = new Date().toISOString();
  await scope.triggers.create({
    type: 'manual',
    namespace,
    workflowName,
    name: MANUAL_TRIGGER_NAME,
    enabled: true,
    config: {},
    lastTriggeredAt: null,
    createdAt: seededAt,
    updatedAt: seededAt,
  });
}
