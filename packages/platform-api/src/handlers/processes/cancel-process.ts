import type { ProcessInstanceRepository } from '@mediforce/platform-core';
import type {
  CancelProcessInput,
  CancelProcessOutput,
} from '../../contract/processes.js';
import { ConflictError, NotFoundError } from '../../errors.js';

export interface CancelProcessDeps {
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Pure handler: mark a `running` or `paused` instance as `failed` with the
 * reason `'Cancelled by user'`. Any other starting status surfaces as 409.
 * No audit event written today — preserves pre-migration behaviour.
 */
export async function cancelProcess(
  input: CancelProcessInput,
  deps: CancelProcessDeps,
): Promise<CancelProcessOutput> {
  const instance = await deps.instanceRepo.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Instance ${input.instanceId} not found`);
  }
  if (instance.status !== 'running' && instance.status !== 'paused') {
    throw new ConflictError(
      `Cannot cancel instance in status '${instance.status}'`,
    );
  }

  await deps.instanceRepo.update(input.instanceId, {
    status: 'failed',
    error: 'Cancelled by user',
    updatedAt: new Date().toISOString(),
  });

  return { instanceId: input.instanceId, status: 'failed' };
}
