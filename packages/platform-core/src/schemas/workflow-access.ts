import { z } from 'zod';

/**
 * Who may **run** and who may **edit** one workflow (ADR-0019).
 *
 * Both lists hold Role names, never uids, and an **empty list means "any
 * workspace member"** — the behaviour every workflow had before the gate
 * existed. Stored beside the workflow rather than inside its versioned
 * definition; the storage and its reasons are in
 * `platform-infra/src/postgres/schema/workflow-access.ts`.
 */
export const WorkflowAccessSchema = z.object({
  /** Roles allowed to start a run. Empty means any workspace member. */
  run: z.array(z.string().min(1).max(64)).max(64).default([]),
  /**
   * Roles allowed to change the workflow — register a version, archive,
   * delete, transfer, set visibility, set the default version. Empty means any
   * workspace member.
   */
  edit: z.array(z.string().min(1).max(64)).max(64).default([]),
});

export type WorkflowAccess = z.infer<typeof WorkflowAccessSchema>;

/** The unconfigured workflow: both verbs open to every workspace member. */
export const OPEN_WORKFLOW_ACCESS: WorkflowAccess = { run: [], edit: [] };

/** Whether `access` gates nothing — the state that has no stored row. */
export function isOpenWorkflowAccess(access: WorkflowAccess): boolean {
  return access.run.length === 0 && access.edit.length === 0;
}
