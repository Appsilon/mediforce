import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import type { GetTaskInput, GetTaskOutput } from '../../contract/tasks.js';

export async function getTask(
  input: GetTaskInput,
  scope: CallerScope,
): Promise<GetTaskOutput> {
  const task = await scope.tasks.getById(input.taskId);
  if (task === null) throw new NotFoundError('Task not found');
  return task;
}
