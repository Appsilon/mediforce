/**
 * Shared path/branch conventions for the run-workspace storage layout.
 * Used by WorkspaceManager (read-write) and WorkspaceReader (read-only) —
 * single source of truth so the two can never drift apart.
 *
 * Layout (under `dataDir`, defaulting to `${MEDIFORCE_DATA_DIR ?? ~/.mediforce}`):
 *
 *   bare-repos/<namespace>/<name>.git/
 *   worktrees/<namespace>/<name>/<runId>/
 *
 * Run branches are named `run/<runId>` (raw runId — only filesystem path
 * segments are sanitized).
 */
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WorkflowIdentity {
  name: string;
  namespace?: string;
}

export function sanitizeSegment(segment: string): string {
  // Allow alphanumerics, dashes, underscores, dots. Replace anything else with an underscore.
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function defaultDataDir(): string {
  return process.env.MEDIFORCE_DATA_DIR ?? join(homedir(), '.mediforce');
}

export function bareRepoPathFor(dataDir: string, workflow: WorkflowIdentity): string {
  return join(dataDir, 'bare-repos', sanitizeSegment(workflow.namespace ?? '_default'), `${sanitizeSegment(workflow.name)}.git`);
}

export function worktreePathFor(dataDir: string, workflow: WorkflowIdentity, runId: string): string {
  return join(dataDir, 'worktrees', sanitizeSegment(workflow.namespace ?? '_default'), sanitizeSegment(workflow.name), sanitizeSegment(runId));
}

export function runBranchName(runId: string): string {
  return `run/${runId}`;
}
