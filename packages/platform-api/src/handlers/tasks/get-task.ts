import type {
  HumanTaskRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { callerCanAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { GetTaskInput, GetTaskOutput } from '../../contract/tasks.js';

export interface GetTaskDeps {
  humanTaskRepo: HumanTaskRepository;
  instanceRepo: ProcessInstanceRepository;
}

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
  if (!callerCanAccess(caller, instance?.namespace)) {
    throw new NotFoundError('Task not found');
  }

  return task;
}
