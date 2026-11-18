import { InvalidTransitionError } from '@mediforce/workflow-engine';
import type { ProcessInstance } from '@mediforce/platform-core';
import type { RetryStepInput, RetryStepOutput } from '../../contract/processes';
import type { CallerScope } from '../../repositories/index';
import { PreconditionFailedError } from '../../errors';
import { actorFromCaller, loadOr404 } from '../_helpers';

/**
 * Refuse a retry that would silently run a different Agent than the one that
 * last ran this step (ADR-0029 versioning, epic #1673 B1/B2): a retry pinned
 * to no Agent, or to one with no recorded version yet, has nothing to compare
 * against and is let through. A step that pins its own `agentVersion` always
 * retries on that version — never drift — so it is compared against the pin,
 * not the Agent's current one; only an unpinned (legacy) step is compared
 * against current, since that is what it would actually run on retry.
 */
async function assertNoAgentDrift(scope: CallerScope, run: ProcessInstance, stepId: string): Promise<void> {
  if (run.namespace === undefined) return;
  const definition = await scope.workflowDefinitions.get(run.namespace, run.definitionName, Number(run.definitionVersion));
  const step = definition?.steps.find((candidate) => candidate.id === stepId);
  const agentId = step?.agentId;
  if (agentId === undefined) return;

  const lastAgentRun = (await scope.agentRuns.getByInstanceId(run.id))
    .filter((agentRun) => agentRun.stepId === stepId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
  const ranVersion = lastAgentRun?.agentVersion;
  if (ranVersion == null) return;

  const [newest] = await scope.agentDefinitions.listVersions(agentId);
  const targetVersion = step?.agentVersion ?? newest?.version;
  if (targetVersion !== undefined && targetVersion !== ranVersion) {
    throw new PreconditionFailedError(
      `Agent '${agentId}' changed since step '${stepId}' last ran (ran v${ranVersion}, now v${targetVersion}); `
      + 'retrying would not reproduce it. Pass allowAgentDrift to retry on the current Agent anyway.',
      { agentId, ranVersion, currentVersion: targetVersion },
    );
  }
}

// Engine emits `step.retried` (stepExecution-scoped); handler additionally
// emits `instance.retried` for the processInstance-scoped audit lane.
export async function retryStep(
  input: RetryStepInput,
  scope: CallerScope,
): Promise<RetryStepOutput> {
  // Workspace gate up front — engine.retryStep loads via raw repo.
  const run = await loadOr404(scope.runs.getById(input.runId), 'Run not found');

  if (input.allowAgentDrift !== true) {
    await assertNoAgentDrift(scope, run, input.stepId);
  }

  const actor = actorFromCaller(scope);

  // Read before the engine flips the instance to `running` — once it does, a
  // worker can claim the run and append a fresh execution, which would make
  // this the retry's own execution instead of the failed one it replaces.
  const executions = await scope.runs.getStepExecutions(input.runId);
  const latestForStep = executions
    .filter((e) => e.stepId === input.stepId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];

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
    // No execution id: the retry's execution is created later by the runner
    // kick, so it is unknowable here.
    outputSnapshot: {
      resetTo: 'running',
      currentStepId: input.stepId,
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
