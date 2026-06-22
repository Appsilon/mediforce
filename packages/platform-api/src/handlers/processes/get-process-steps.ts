import type { StepExecution } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type { GetProcessStepsInput, GetProcessStepsOutput, StepEntry } from '../../contract/processes';

/**
 * Derived per-step view combining workflow-definition order, the latest step
 * execution per step, and `instance.variables[stepId]` for human steps.
 * Algorithm ported verbatim from the pre-migration Next.js route — status
 * derivation rules unchanged. Workspace gating lives in the run wrapper.
 */
export async function getProcessSteps(input: GetProcessStepsInput, scope: CallerScope): Promise<GetProcessStepsOutput> {
  const { instanceId } = input;

  const instance = await scope.runs.getById(instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${instanceId} not found`);
  }

  const versionNum = Number.parseInt(instance.definitionVersion, 10);
  const definition = Number.isFinite(versionNum)
    ? await scope.workflowDefinitions.get(instance.namespace ?? '', instance.definitionName, versionNum)
    : null;

  if (definition === null) {
    throw new NotFoundError(`Workflow definition ${instance.definitionName}@${instance.definitionVersion} not found`);
  }

  const allExecutions = await scope.runs.getStepExecutions(instanceId);

  const executionsByStep = new Map<string, StepExecution[]>();
  for (const exec of allExecutions) {
    const bucket = executionsByStep.get(exec.stepId);
    if (bucket === undefined) {
      executionsByStep.set(exec.stepId, [exec]);
    } else {
      bucket.push(exec);
    }
  }

  const currentStepId = instance.currentStepId;
  const variables = (instance.variables ?? {}) as Record<string, Record<string, unknown>>;

  const stepEntries: StepEntry[] = [];

  for (const step of definition.steps) {
    if (step.type === 'terminal') continue;

    const executorType: StepEntry['executorType'] = step.executor ?? 'unknown';
    const stepExecs = executionsByStep.get(step.id) ?? [];
    const latestExec = stepExecs.reduce<StepExecution | null>(
      (best, e) => (best === null || e.startedAt > best.startedAt ? e : best),
      null,
    );
    const stepVariables = variables[step.id] ?? null;

    let status: StepEntry['status'];
    if (instance.status === 'completed') {
      if (currentStepId === null) {
        status = latestExec !== null || stepVariables !== null ? 'completed' : 'pending';
      } else if (step.id === currentStepId) {
        status = 'completed';
      } else {
        const hasOutput = latestExec?.output !== null || stepVariables !== null;
        status = hasOutput ? 'completed' : 'pending';
      }
    } else if (step.id === currentStepId) {
      status = 'running';
    } else {
      const hasCompleted = stepExecs.some((e) => e.status === 'completed') || stepVariables !== null;
      status = hasCompleted ? 'completed' : 'pending';
    }

    let stepInput: Record<string, unknown> | null = null;
    let stepOutput: Record<string, unknown> | null = null;
    if (executorType === 'agent' && latestExec !== null) {
      stepInput = latestExec.input;
      stepOutput = latestExec.output;
    } else if (executorType === 'human') {
      stepInput = step.ui !== undefined ? { ui: step.ui } : null;
      stepOutput = stepVariables;
    }

    stepEntries.push({
      stepId: step.id,
      name: step.name,
      type: step.type,
      executorType,
      status,
      input: stepInput,
      output: stepOutput,
      executions: stepExecs,
    });
  }

  return {
    instanceId,
    definitionName: instance.definitionName,
    definitionVersion: instance.definitionVersion,
    instanceStatus: instance.status,
    instanceError: instance.error ?? null,
    currentStepId,
    steps: stepEntries,
  };
}
