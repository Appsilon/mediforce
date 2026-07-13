import type { HumanTask, StepExecution } from '@mediforce/platform-core';

export interface ViewerIdentity {
  uid: string | null;
  role: string | null;
}

/**
 * How the current viewer may interact with the step's human task.
 *
 * `claimed-by-other` / `role-mismatch` render the task read-only with a
 * banner — the server enforces the claimant on complete, this is the UI
 * mirror of that rule. A viewer without a role claim (workspace admins
 * browsing) is treated as allowed; the engine auto-claims on completion.
 */
export type HumanStepAccess =
  | { kind: 'actionable' }
  | { kind: 'claimed-by-other'; claimedBy: string }
  | { kind: 'role-mismatch'; requiredRole: string }
  | { kind: 'completed' };

export type StepView =
  | { kind: 'human-step'; task: HumanTask; access: HumanStepAccess }
  | { kind: 'execution-results' }
  | { kind: 'not-executed' };

const ACTIONABLE: ReadonlySet<HumanTask['status']> = new Set(['pending', 'claimed']);

/**
 * Decides what the run-step page shows, in precedence order:
 *
 * 1. An actionable human task (pending/claimed) → the task UI, locked when
 *    the viewer cannot act on it.
 * 2. A completed human task → the read-only task body alongside the
 *    execution's input/output.
 * 3. An execution without tasks (agent/script/gate step) → the generic
 *    execution-results view.
 * 4. Nothing yet → the "not executed" placeholder.
 *
 * `tasks` must already be scoped to this step. When several tasks exist
 * (L3 revise loops re-open the step) the most recently created one wins.
 */
export function resolveStepView(args: {
  tasks: HumanTask[];
  execution: StepExecution | null;
  viewer: ViewerIdentity;
}): StepView {
  const candidates = [...args.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const actionable = candidates.find((task) => ACTIONABLE.has(task.status));
  if (actionable !== undefined) {
    return {
      kind: 'human-step',
      task: actionable,
      access: accessFor(actionable, args.viewer),
    };
  }

  const completed = candidates.find((task) => task.status === 'completed');
  if (completed !== undefined) {
    return { kind: 'human-step', task: completed, access: { kind: 'completed' } };
  }

  if (args.execution !== null) {
    return { kind: 'execution-results' };
  }
  return { kind: 'not-executed' };
}

function accessFor(task: HumanTask, viewer: ViewerIdentity): HumanStepAccess {
  if (task.assignedUserId !== null && task.assignedUserId !== viewer.uid) {
    return { kind: 'claimed-by-other', claimedBy: task.assignedUserId };
  }
  if (viewer.role !== null && task.assignedRole !== viewer.role) {
    return { kind: 'role-mismatch', requiredRole: task.assignedRole };
  }
  return { kind: 'actionable' };
}
