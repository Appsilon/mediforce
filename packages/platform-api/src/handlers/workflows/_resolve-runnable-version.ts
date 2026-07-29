import type { WorkflowDefinition } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';

export type RunnableVersion =
  | { ok: true; def: WorkflowDefinition }
  | { ok: false; reason: string };

/**
 * Resolve the Workflow Definition version a trigger fires (ADR-0011): the
 * workflow's default version when it is itself runnable, otherwise the newest
 * live (non-archived, non-deleted) version.
 *
 * Both the default pointer and `getLatestVersion` include archived versions, so
 * selecting from them directly would skip a workflow whose head is archived even
 * though an earlier version is still runnable. Deleted or fully-archived targets
 * resolve to `ok: false` so a stale trigger row can never fire a ghost run.
 *
 * Shared by the cron heartbeat (which version *will* this tick fire?) and cron
 * trigger create/update (which contract must this static payload satisfy?) —
 * ADR-0012 validates a cron payload at attach time and again at fire time, and
 * the two are only meaningfully comparable if they resolve the same version.
 */
export async function resolveRunnableVersion(
  scope: CallerScope,
  namespace: string,
  workflowName: string,
): Promise<RunnableVersion> {
  if (await scope.workflowDefinitions.isNameDeleted(namespace, workflowName)) {
    return { ok: false, reason: 'Workflow deleted' };
  }
  const versions = await scope.workflowDefinitions.listVersions(namespace, workflowName);
  if (versions.length === 0) return { ok: false, reason: 'No resolvable version' };

  const live = versions.filter((v) => v.archived !== true && v.deleted !== true);
  if (live.length === 0) return { ok: false, reason: 'No live version' };

  const defaultVersion = await scope.workflowDefinitions.getDefaultVersion(namespace, workflowName);
  const def =
    live.find((v) => v.version === defaultVersion) ??
    live.reduce((newest, v) => (v.version > newest.version ? v : newest));
  return { ok: true, def };
}
