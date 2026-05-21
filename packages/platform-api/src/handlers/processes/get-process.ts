import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import type { GetProcessInput, GetProcessOutput } from '../../contract/processes.js';

/**
 * Get a single process instance by id. Workspace membership gates the lookup
 * inside the wrapper: out-of-scope rows return null → 404, eliminating the
 * "exists but denied" leak.
 */
export async function getProcess(
  input: GetProcessInput,
  scope: CallerScope,
): Promise<GetProcessOutput> {
  const instance = await scope.runs.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }
  return instance;
}
