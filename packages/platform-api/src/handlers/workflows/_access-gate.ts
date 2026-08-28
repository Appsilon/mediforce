import type { WorkflowAccess } from '@mediforce/platform-core';
import {
  assertCallerHoldsRole,
  callerHoldsRole,
  type CallerIdentity,
  type ProcessRoleDirectory,
} from '../../auth';
import type { CallerScope } from '../../repositories/index';

/**
 * Enforce a workflow's `run` / `edit` role lists (ADR-0019, issue #1253) —
 * the workflow level of the epic, between workspace Membership below it and
 * `step.allowedRoles` above it.
 *
 * The same `assertCallerHoldsRole` the step gate uses, so all three verbs
 * answer to one predicate and there is a single rule to learn: absent or empty
 * means any workspace member, a listed role means the caller must hold one of
 * them for *this* workflow, and system actors bypass — which is why a cron or
 * webhook firing is unaffected by a `run` gate.
 *
 * Membership is a separate, earlier question that the wrapper layer already
 * answers (ADR-0004 §4): these helpers add capability on top of reachability,
 * never instead of it.
 */
export async function assertCallerMayRunWorkflow(
  scope: CallerScope,
  namespace: string,
  name: string,
): Promise<void> {
  await assertVerb(scope, namespace, name, 'run');
}

/**
 * `edit` covers registering a version, archiving, deleting, transferring,
 * setting visibility and moving the default version — one verb, not six.
 *
 * Grouping them is the decision, not an omission: delete is strictly more
 * dangerous than edit, so a workflow where someone may edit but may not
 * archive is a distinction nobody wants to administer, and every one of these
 * operations was gated by workspace membership alone until now.
 */
export async function assertCallerMayEditWorkflow(
  scope: CallerScope,
  namespace: string,
  name: string,
): Promise<void> {
  await assertVerb(scope, namespace, name, 'edit');
}

/**
 * The same two questions answered rather than enforced, for the client that
 * has to decide what to *offer* — the Access tab and the Start button next to
 * it. Sharing the predicate is the point: a button that computes "may I run
 * this" its own way is how a UI ends up offering an action the server then
 * refuses (#1249, #1251).
 *
 * Takes the caller and directory rather than a scope, like `callerHoldsRole`
 * below it, so a listing can hand it a memoized directory without rebuilding
 * a scope around one field.
 */
export async function resolveCallerWorkflowVerbs(
  caller: CallerIdentity,
  directory: ProcessRoleDirectory | null,
  namespace: string,
  name: string,
  access: WorkflowAccess,
): Promise<{ mayRun: boolean; mayEdit: boolean }> {
  const [mayRun, mayEdit] = await Promise.all([
    callerHoldsRole(caller, namespace, name, access.run, directory),
    callerHoldsRole(caller, namespace, name, access.edit, directory),
  ]);
  return { mayRun, mayEdit };
}

/** How each verb names itself in its own refusal — see `assertCallerHoldsRole`. */
const SUBJECTS = {
  run: 'Starting a run of this workflow',
  edit: 'Changing this workflow',
} as const;

async function assertVerb(
  scope: CallerScope,
  namespace: string,
  name: string,
  verb: 'run' | 'edit',
): Promise<void> {
  // A system actor passes the gate whatever it says, so it need not pay for
  // the read — the cron heartbeat crosses this path on every tick.
  if (scope.caller.isSystemActor) return;

  const access = await scope.workflowDefinitions.getAccess(namespace, name);
  const allowedRoles = verb === 'run' ? access.run : access.edit;
  await assertCallerHoldsRole(
    scope.caller,
    namespace,
    name,
    allowedRoles,
    scope.system.userDirectory,
    { subject: SUBJECTS[verb] },
  );
}
