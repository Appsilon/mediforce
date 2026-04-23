import type { ProcessRepository } from '@mediforce/platform-core';
import type {
  CreateProcessInput,
  CreateProcessOutput,
} from '../../contract/processes.js';
import { NotFoundError } from '../../errors.js';
import type { TriggerRun } from '../tasks/complete-task.js';

export interface ManualTriggerLike {
  fireWorkflow(context: {
    definitionName: string;
    definitionVersion: number;
    triggerName: string;
    triggeredBy: string;
    payload: Record<string, unknown>;
  }): Promise<{ instanceId: string; status: 'created' }>;
}

export interface CreateProcessDeps {
  manualTrigger: ManualTriggerLike;
  processRepo: Pick<ProcessRepository, 'getLatestWorkflowVersion'>;
  triggerRun?: TriggerRun;
}

/**
 * Pure handler: start a new process instance.
 *
 * When `definitionVersion` is omitted the handler resolves the latest version
 * published for the workflow; a workflow with no versions throws
 * `NotFoundError` (maps to 404).
 *
 * The optional `triggerRun` dep is invoked after the instance is created so
 * the auto-runner can pick up agent steps. The handler itself does not wait
 * on it — it's fire-and-forget semantics preserved from the inline route.
 */
export async function createProcess(
  input: CreateProcessInput,
  deps: CreateProcessDeps,
): Promise<CreateProcessOutput> {
  let version = input.definitionVersion;
  if (version === undefined) {
    version = await deps.processRepo.getLatestWorkflowVersion(input.definitionName);
    if (version === 0) {
      throw new NotFoundError(
        `No workflow definition found for '${input.definitionName}'`,
      );
    }
  }

  const result = await deps.manualTrigger.fireWorkflow({
    definitionName: input.definitionName,
    definitionVersion: version,
    triggerName: input.triggerName ?? 'manual',
    triggeredBy: input.triggeredBy,
    payload: input.payload ?? {},
  });

  if (deps.triggerRun !== undefined) {
    deps.triggerRun(result.instanceId, input.triggeredBy);
  }

  return {
    instanceId: result.instanceId,
    status: result.status,
  };
}
