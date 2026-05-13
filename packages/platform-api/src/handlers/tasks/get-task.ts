import type {
  HumanTaskRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { assertNamespaceAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { GetTaskInput, GetTaskOutput } from '../../contract/tasks.js';

export interface GetTaskDeps {
  humanTaskRepo: HumanTaskRepository;
  /** Used to resolve the task's parent instance for namespace gating. */
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Get a single task by id. The instance's namespace gates access — api-key
 * callers always pass, user callers must be members of the instance's
 * namespace. 404 surfaces before 403 (a non-existent id never reveals
 * "exists but denied").
 */
export async function getTask(
  input: GetTaskInput,
  deps: GetTaskDeps,
  caller: CallerIdentity,
): Promise<GetTaskOutput> {
  const task = await deps.humanTaskRepo.getById(input.taskId);
  if (task === null) {
    throw new NotFoundError('Task not found');
  }

  const instance = await deps.instanceRepo.getById(task.processInstanceId);
  assertNamespaceAccess(caller, instance?.namespace);

  return task;
}
