import type { ProcessInstanceRepository } from '@mediforce/platform-core';
import type { GetProcessInput, GetProcessOutput } from '../../contract/processes.js';
import { NotFoundError } from '../../errors.js';

export interface GetProcessDeps {
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Pure handler: return the process instance by id. Missing → `NotFoundError`.
 */
export async function getProcess(
  input: GetProcessInput,
  deps: GetProcessDeps,
): Promise<GetProcessOutput> {
  const instance = await deps.instanceRepo.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }
  return instance;
}
