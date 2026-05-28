import type { HumanTask, HumanTaskStatus } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index.js';
import type { ListTasksInput, ListTasksOutput } from '../../contract/tasks.js';

/**
 * List tasks visible to the caller. Workspace gating is enforced by the
 * `scope.tasks` wrapper: it filters out tasks whose parent run belongs to a
 * workspace the caller isn't a member of (apiKey callers bypass).
 *
 * Input validation is the adapter's job. Output validation is the contract's
 * job (the Zod schema is the source of truth — handlers conform by type, not
 * by runtime parse).
 */
export async function listTasks(
  input: ListTasksInput,
  scope: CallerScope,
): Promise<ListTasksOutput> {
  const base = await selectBase(input, scope);
  return { tasks: applyFilters(base, input) };
}

async function selectBase(
  input: ListTasksInput,
  scope: CallerScope,
): Promise<readonly HumanTask[]> {
  if (input.instanceId !== undefined) return scope.tasks.getByInstanceId(input.instanceId);
  if (input.role !== undefined) return scope.tasks.getByRole(input.role);
  return scope.tasks.listForCaller();
}

function applyFilters(
  tasks: readonly HumanTask[],
  input: ListTasksInput,
): HumanTask[] {
  const statusSet = input.status !== undefined ? new Set<HumanTaskStatus>(input.status) : null;
  const stepId = input.stepId;
  return tasks.filter((task) => {
    if (statusSet !== null && !statusSet.has(task.status)) return false;
    if (stepId !== undefined && task.stepId !== stepId) return false;
    return true;
  });
}
