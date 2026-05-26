import { InvalidTransitionError } from '@mediforce/workflow-engine';
import type { RetryStepInput, RetryStepOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { actorFromCaller, loadOr404 } from '../_helpers.js';

// Engine emits `step.retried` (stepExecution-scoped); handler additionally
// emits `instance.retried` for the processInstance-scoped audit lane.
export async function retryStep(
  input: RetryStepInput,
  scope: CallerScope,
): Promise<RetryStepOutput> {
  // Workspace gate up front — engine.retryStep loads via raw repo.
  await loadOr404(scope.runs.getById(input.runId), 'Run not found');

  const actor = actorFromCaller(scope);

  let updated;
  try {
    updated = await scope.system.engine.retryStep(input.runId, input.stepId, {
      id: actor.actorId,
      role: 'operator',
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      throw new PreconditionFailedError(err.message, {
        fromStatus: err.fromStatus,
        operation: err.operation,
      });
    }
    throw err;
  }

  const executions = await scope.runs.getStepExecutions(input.runId);
  const latestForStep = executions
    .filter((e) => e.stepId === input.stepId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

  await scope.system.audit.append({
    ...actor,
    action: 'instance.retried',
    description: `Retried failed step '${input.stepId}' on instance '${input.runId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      instanceId: input.runId,
      stepId: input.stepId,
      previousExecutionId: latestForStep?.id ?? null,
      previousError: latestForStep?.error ?? null,
    },
    outputSnapshot: {
      resetTo: 'running',
      currentStepId: input.stepId,
      newExecutionId: latestForStep?.id ?? null,
    },
    basis: 'User requested retry of failed step via API',
    entityType: 'processInstance',
    entityId: input.runId,
    processInstanceId: input.runId,
    processDefinitionVersion: updated.definitionVersion,
  });

  await scope.system.runKicker.kick(input.runId, { triggeredBy: actor.actorId });

  return { run: updated };
}
