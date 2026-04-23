import type {
  AuditRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type {
  ResumeProcessInput,
  ResumeProcessOutput,
} from '../../contract/processes.js';
import { ConflictError, NotFoundError } from '../../errors.js';
import type { TriggerRun } from '../tasks/complete-task.js';

export interface ResumeProcessDeps {
  instanceRepo: ProcessInstanceRepository;
  auditRepo: AuditRepository;
  triggerRun?: TriggerRun;
}

/**
 * Pure handler: resume a `paused` instance. Any other status is a 409.
 * Writes a `process.resumed` audit event and optionally kicks the
 * auto-runner.
 */
export async function resumeProcess(
  input: ResumeProcessInput,
  deps: ResumeProcessDeps,
): Promise<ResumeProcessOutput> {
  const instance = await deps.instanceRepo.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Instance ${input.instanceId} not found`);
  }
  if (instance.status !== 'paused') {
    throw new ConflictError(
      `Instance is '${instance.status}', expected 'paused'`,
    );
  }

  const now = new Date().toISOString();
  await deps.instanceRepo.update(input.instanceId, {
    status: 'running',
    pauseReason: null,
    error: null,
    updatedAt: now,
  });

  await deps.auditRepo.append({
    actorId: 'api-user',
    actorType: 'user',
    actorRole: 'operator',
    action: 'process.resumed',
    description: `Process '${input.instanceId}' manually resumed via API`,
    timestamp: now,
    inputSnapshot: { previousPauseReason: instance.pauseReason },
    outputSnapshot: { status: 'running' },
    basis: 'Manual resume via API',
    entityType: 'processInstance',
    entityId: input.instanceId,
    processInstanceId: input.instanceId,
  });

  if (deps.triggerRun !== undefined) {
    deps.triggerRun(input.instanceId, 'api-user');
  }

  return { ok: true, instanceId: input.instanceId, status: 'running' };
}
