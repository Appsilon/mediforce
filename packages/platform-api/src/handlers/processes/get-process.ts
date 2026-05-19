import type { ProcessInstanceRepository } from '@mediforce/platform-core';
import { callerCanAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { GetProcessInput, GetProcessOutput } from '../../contract/processes.js';

export interface GetProcessDeps {
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Get a single process instance by id. The instance's namespace gates access:
 * api-key callers always pass, user callers must be members of the
 * namespace. Access denial surfaces as 404 (not 403) — a non-member caller
 * cannot distinguish "instance exists but denied" from "instance doesn't
 * exist", eliminating the ID-enumeration leak.
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

  if (!callerCanAccess(caller, instance.namespace)) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }

  return instance;
}
