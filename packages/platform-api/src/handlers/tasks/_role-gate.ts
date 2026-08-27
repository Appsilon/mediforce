import type { HumanTask } from '@mediforce/platform-core';
import { assertCallerHoldsRole } from '../../auth';
import { ForbiddenError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { loadPinnedDefinition } from '../_helpers';

/**
 * Enforce the step's `allowedRoles` on the human action a caller is taking —
 * claiming or completing a task (ADR-0019).
 *
 * `allowedRoles` comes off the run's pinned Workflow Definition; see
 * `assertCallerHoldsRole` for why not off `HumanTask.assignedRole`.
 *
 * Two unresolved cases, decided differently on purpose:
 *
 * - **The definition does not resolve** — the pinned version was deleted, or
 *   the workflow was transferred to another workspace and left the run's
 *   `namespace` on the source. Refuse: we cannot read what the author wrote,
 *   and un-gating a step by making its definition unreachable is a bypass
 *   anyone who can delete or transfer a workflow could take today. A version
 *   that resolves but postdates the run is the same case wearing the pin's
 *   name: version numbering restarts at 1 once the last version leaves a
 *   workspace, so re-registering the name after a delete or a transfer plants
 *   a definition an in-flight run's `v1` pin would otherwise resolve to.
 * - **The definition resolves but does not describe this step.** That is not an
 *   unknown — it is a definite "no restriction declared", so the step stays
 *   open exactly as before the gate existed.
 */
export async function assertCallerMayActOnTask(
  scope: CallerScope,
  task: HumanTask,
): Promise<void> {
  // System actors bypass the gate anyway; returning here spares them the reads.
  if (scope.caller.isSystemActor) return;

  const run = await scope.runs.getById(task.processInstanceId);
  const definition = run === null ? null : await loadPinnedDefinition(scope, run);
  if (run === null || definition === null || postdatesRun(definition, run)) {
    throw new ForbiddenError(
      'Cannot check who may act on this task: the workflow version this run is ' +
        'pinned to is not readable in this workspace. It was deleted, moved to ' +
        'another workspace, or replaced by a workflow registered under the same ' +
        'name after this run started.',
      { taskId: task.id, processInstanceId: task.processInstanceId },
    );
  }

  const step = definition.steps.find((candidate) => candidate.id === task.stepId);
  if (step === undefined) return;

  await assertCallerHoldsRole(
    scope.caller,
    definition.namespace,
    definition.name,
    step.allowedRoles,
    scope.system.userDirectory,
  );
}

/**
 * Whether the definition that answered the run's pin was registered after the
 * run began — which the one the run pinned cannot have been.
 *
 * `createdAt` is optional on the schema (definitions written before it existed
 * carry none), and an absent one is not evidence of a replacement, so it reads
 * as the original.
 */
function postdatesRun(
  definition: { readonly createdAt?: string },
  run: { readonly createdAt: string },
): boolean {
  if (definition.createdAt === undefined) return false;
  return Date.parse(definition.createdAt) > Date.parse(run.createdAt);
}
