import type { HumanTaskRepository } from '@mediforce/platform-core';
import type { GetTaskInput, GetTaskOutput } from '../../contract/tasks.js';
import { NotFoundError } from '../../errors.js';

export interface GetTaskDeps {
  humanTaskRepo: HumanTaskRepository;
}

/**
 * Pure handler: return the single task for `taskId`.
 *
 * Missing tasks are a user-visible condition (HTTP 404), so the handler
 * throws `NotFoundError` and the route adapter maps it to 404. Keeps the
 * contract type non-nullable — callers that resolve a task receive one.
 */
export async function getTask(
  input: GetTaskInput,
  deps: GetTaskDeps,
): Promise<GetTaskOutput> {
  const task = await deps.humanTaskRepo.getById(input.taskId);
  if (task === null) {
    throw new NotFoundError(`Task ${input.taskId} not found`);
  }
  return task;
}
