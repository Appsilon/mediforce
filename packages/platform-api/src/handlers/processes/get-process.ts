import type { ProcessInstanceRepository } from '@mediforce/platform-core';
import { assertNamespaceAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { GetProcessInput, GetProcessOutput } from '../../contract/processes.js';

export interface GetProcessDeps {
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Get a single process instance by id. The instance's namespace gates access:
 * api-key callers always pass, user callers must be members of the
 * namespace. 404 surfaces before 403 — a non-existent id never reveals
 * "exists but denied".
 */
export async function getProcess(
  input: GetProcessInput,
  deps: GetProcessDeps,
  caller: CallerIdentity,
): Promise<GetProcessOutput> {
  const instance = await deps.instanceRepo.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }

  assertNamespaceAccess(caller, instance.namespace);

  return instance;
}
