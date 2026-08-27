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
 *   anyone who can delete or transfer a workflow could take today.
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
  if (run === null || definition === null) {
    throw new ForbiddenError(
      'Cannot check who may act on this task: the workflow version this run is ' +
        'pinned to is not readable in this workspace. It was deleted, or the ' +
        'workflow was moved to another workspace.',
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
