import type { HumanTask, RunDefinitionPin, WorkflowDefinition } from '@mediforce/platform-core';
import { callerHoldsRole, memoizeProcessRoleReads } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import { loadPinnedDefinition } from '../_helpers';
import { resolveStepGate } from './_role-gate';

/**
 * Narrow a task list to the ones the caller can act on (issue #1251).
 *
 * Three ways a task qualifies, and the order matters — the first two are
 * answered off the task alone, so only what is left costs a read:
 *
 * 1. **Assigned to the caller.** Theirs whatever the status: a task they
 *    claimed, or one a step's `assignedTo` addressed to them by name. The
 *    assignment wins even over the role gate — a step that names someone who
 *    does not hold its role is mis-authored, and hiding the task would leave
 *    them nothing to see and nothing to explain it. The 403 on the claim names
 *    the missing grant; an empty inbox names nothing.
 * 2. **Assigned to someone else.** Never actionable, whatever roles the caller
 *    holds — the same rule `completeTask` enforces ("Task is claimed by another
 *    user"), and the one the UI hooks already applied client-side.
 * 3. **Unassigned and `pending`.** The step's `allowedRoles` decides, resolved
 *    through the shared `resolveStepGate` so the inbox and the claim gate
 *    cannot disagree.
 *
 * System actors bypass: they hold no roles and have no inbox, so `actionable`
 * is a no-op rather than an empty list.
 *
 * Reads are batched per distinct run, per distinct pinned workflow version and
 * per distinct `(workspace, workflow)` role question — an inbox of thirty tasks
 * across three workflows costs one run read, three definition reads and at most
 * three directory reads, not thirty of each.
 */
export async function filterActionable(
  tasks: readonly HumanTask[],
  scope: CallerScope,
): Promise<HumanTask[]> {
  const caller = scope.caller;
  if (caller.kind !== 'user') return [...tasks];

  const undecided: HumanTask[] = [];
  const actionableIds = new Set<string>();
  for (const task of tasks) {
    if (task.assignedUserId === caller.uid) actionableIds.add(task.id);
    else if (task.assignedUserId === null && task.status === 'pending') undecided.push(task);
  }
  const pins = await loadPins(undecided, scope);
  const definitions = await loadDefinitions(pins, scope);
  const directory = memoizeProcessRoleReads(scope.system.userDirectory);

  const verdicts = await Promise.all(
    undecided.map(async (task) => {
      const pin = pins.get(task.processInstanceId) ?? null;
      const definition = pin === null ? null : definitions.get(pinKey(pin)) ?? null;
      const gate = resolveStepGate(task, pin, definition);
      if (gate.kind === 'unreadable') return false;
      if (gate.kind === 'open') return true;
      return callerHoldsRole(caller, gate.namespace, gate.workflow, gate.allowedRoles, directory);
    }),
  );
  undecided.forEach((task, index) => {
    if (verdicts[index] === true) actionableIds.add(task.id);
  });

  return tasks.filter((task) => actionableIds.has(task.id));
}

/** Pinned-definition coordinates per run id, one read for the whole list. */
async function loadPins(
  tasks: readonly HumanTask[],
  scope: CallerScope,
): Promise<Map<string, RunDefinitionPin>> {
  const runIds = [...new Set(tasks.map((task) => task.processInstanceId))];
  const pins = await scope.runs.getDefinitionPins(runIds);
  return new Map(pins.map((pin) => [pin.id, pin]));
}

/**
 * The definition each distinct pin resolves to — one read per
 * `(workspace, name, version)`, not per task. Runs of the same workflow version
 * share a read, which is the common shape of an inbox.
 */
async function loadDefinitions(
  pins: ReadonlyMap<string, RunDefinitionPin>,
  scope: CallerScope,
): Promise<Map<string, WorkflowDefinition | null>> {
  const distinct = new Map<string, RunDefinitionPin>();
  for (const pin of pins.values()) distinct.set(pinKey(pin), pin);

  const loaded = await Promise.all(
    [...distinct].map(async ([key, pin]): Promise<[string, WorkflowDefinition | null]> => [
      key,
      await loadPinnedDefinition(scope, pin),
    ]),
  );
  return new Map(loaded);
}

function pinKey(pin: RunDefinitionPin): string {
  return JSON.stringify([pin.namespace ?? '', pin.definitionName, pin.definitionVersion]);
}
