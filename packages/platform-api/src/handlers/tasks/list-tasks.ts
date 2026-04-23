import type { HumanTask, HumanTaskRepository, HumanTaskStatus } from '@mediforce/platform-core';
import type { ListTasksInput, ListTasksOutput } from '../../contract/tasks.js';

export interface ListTasksDeps {
  humanTaskRepo: HumanTaskRepository;
}

/**
 * Pure handler: accepts validated input and services, returns a typed result.
 * Input validation is the adapter's job. Output validation is the contract's
 * job (the Zod schema is the source of truth — handlers conform by type, not
 * by runtime parse).
 */
export async function listTasks(
  input: ListTasksInput,
  deps: ListTasksDeps,
): Promise<ListTasksOutput> {
  const base =
    input.instanceId !== undefined
      ? await deps.humanTaskRepo.getByInstanceId(input.instanceId)
      : await deps.humanTaskRepo.getByRole(input.role);
  return { tasks: applyFilters(base, input) };
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
