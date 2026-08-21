import type { ProcessRepository } from '../interfaces/process-repository';
import type { WorkflowDefinition } from '../schemas/workflow-definition';

/**
 * The three reads version resolution needs, named as the authorized platform-api
 * repository already names them so `scope.workflowDefinitions` satisfies this
 * port with no adapter. `ProcessRepository` carries the same three capabilities
 * under different names — see `toWorkflowVersionSource`.
 */
export interface WorkflowVersionSource {
  isNameDeleted(namespace: string, name: string): Promise<boolean>;
  listVersions(namespace: string, name: string): Promise<WorkflowDefinition[]>;
  getDefaultVersion(namespace: string, name: string): Promise<number | null>;
}

/** Why a workflow has no runnable version. Closed set so a caller that treats
 *  one absence differently from another (a fully-archived workflow still exists
 *  and still owns its trigger rows) branches on a checked value, not on prose. */
export const RUNNABLE_VERSION_REASONS = {
  deleted: 'Workflow deleted',
  noVersions: 'No resolvable version',
  noLiveVersion: 'No live version',
} as const;

export type RunnableVersionReason =
  (typeof RUNNABLE_VERSION_REASONS)[keyof typeof RUNNABLE_VERSION_REASONS];

export type RunnableVersion =
  | { ok: true; def: WorkflowDefinition }
  | { ok: false; reason: RunnableVersionReason };

/** The only three fields the selection rule reads. Kept to the minimum so every
 *  holder of version metadata satisfies it — the server's full
 *  `WorkflowDefinition` and the browser's `WorkflowVersionSummary` alike — and
 *  no caller has to re-implement the rule because its data "doesn't fit". */
export interface VersionCandidate {
  version: number;
  archived?: boolean;
  deleted?: boolean;
}

/**
 * The selection rule itself, pure and dependency-free: the default version when
 * it is itself live, otherwise the newest live (non-archived, non-deleted)
 * version, otherwise nothing.
 *
 * Split out from `resolveRunnableVersion` so a client that already holds the
 * version list runs the rule instead of copying it — the Triggers panel labels
 * its cron payload editor with the contract of the version a firing will use,
 * and a second implementation of "which version?" is exactly how the client and
 * the server drifted apart.
 *
 * Deletion is per *name*, not per version (`setWorkflowDeleted` stamps every
 * version), so the deleted-name gate belongs to the caller that can see it:
 * `resolveRunnableVersion` asks the repository, the browser reads the fetched
 * definition's `deleted` flag. This function only selects among versions.
 */
export function pickRunnableVersion<Candidate extends VersionCandidate>(
  versions: readonly Candidate[],
  defaultVersion: number | null,
): Candidate | null {
  const live = versions.filter(
    (version) => version.archived !== true && version.deleted !== true,
  );
  if (live.length === 0) return null;
  return (
    live.find((version) => version.version === defaultVersion) ??
    live.reduce((newest, version) => (version.version > newest.version ? version : newest))
  );
}

/**
 * Resolve the Workflow Definition version a firing uses (ADR-0011): the
 * workflow's default version when it is itself runnable, otherwise the newest
 * live (non-archived, non-deleted) version.
 *
 * Both the default pointer and `getLatestVersion` include archived versions, so
 * selecting from them directly would skip a workflow whose head is archived even
 * though an earlier version is still runnable. Deleted or fully-archived targets
 * resolve to `ok: false` so a stale trigger row can never fire a ghost run.
 *
 * Shared by every unpinned firing — manual/API start, cron heartbeat (which
 * version *will* this tick fire?), cron trigger create/update (which contract
 * must this static payload satisfy?), and spawn. ADR-0012 makes `triggerInput`
 * the workflow's one total contract, which only holds if every path resolves the
 * same version: a cron payload validated at attach time and again at fire time
 * is comparable only because both stages land here.
 */
export async function resolveRunnableVersion(
  source: WorkflowVersionSource,
  namespace: string,
  workflowName: string,
): Promise<RunnableVersion> {
  if (await source.isNameDeleted(namespace, workflowName)) {
    return { ok: false, reason: RUNNABLE_VERSION_REASONS.deleted };
  }
  const versions = await source.listVersions(namespace, workflowName);
  if (versions.length === 0) {
    return { ok: false, reason: RUNNABLE_VERSION_REASONS.noVersions };
  }

  const defaultVersion = await source.getDefaultVersion(namespace, workflowName);
  const def = pickRunnableVersion(versions, defaultVersion);
  if (def === null) {
    return { ok: false, reason: RUNNABLE_VERSION_REASONS.noLiveVersion };
  }
  return { ok: true, def };
}

/** Adapt a `ProcessRepository` — which spells the same three reads
 *  `isWorkflowNameDeleted` / `listWorkflowVersions` / `getDefaultWorkflowVersion`
 *  — to the resolver's port, so callers holding a raw repo resolve through the
 *  same policy as callers holding a scoped one. */
export function toWorkflowVersionSource(
  repo: Pick<
    ProcessRepository,
    'isWorkflowNameDeleted' | 'listWorkflowVersions' | 'getDefaultWorkflowVersion'
  >,
): WorkflowVersionSource {
  return {
    isNameDeleted: (namespace, name) => repo.isWorkflowNameDeleted(namespace, name),
    listVersions: (namespace, name) => repo.listWorkflowVersions(namespace, name),
    getDefaultVersion: (namespace, name) => repo.getDefaultWorkflowVersion(namespace, name),
  };
}
