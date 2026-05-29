import type { StepExecution } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type {
  GetProcessStepsInput,
  GetProcessStepsOutput,
  StepEntry,
} from '../../contract/processes';

/**
 * Derived per-step view combining workflow-definition order, the latest step
 * execution per step, and `instance.variables[stepId]` for human steps.
 * Algorithm ported verbatim from the pre-migration Next.js route — status
 * derivation rules unchanged. Workspace gating lives in the run wrapper.
 */
export async function getProcessSteps(
  input: GetProcessStepsInput,
  scope: CallerScope,
): Promise<GetProcessStepsOutput> {
  const { instanceId } = input;

  const instance = await scope.runs.getById(instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${instanceId} not found`);
  }

  const versionNum = Number.parseInt(instance.definitionVersion, 10);
  const definition = Number.isFinite(versionNum)
    ? await scope.workflowDefinitions.get(
        instance.namespace ?? '',
        instance.definitionName,
        versionNum,
      )
    : null;

  if (definition === null) {
    throw new NotFoundError(
      `Workflow definition ${instance.definitionName}@${instance.definitionVersion} not found`,
    );
  }

  const executions = await scope.runs.getStepExecutions(instanceId);

  const executionsByStep = new Map<string, StepExecution>();
  for (const exec of executions) {
    const existing = executionsByStep.get(exec.stepId);
    if (existing === undefined || exec.startedAt > existing.startedAt) {
      executionsByStep.set(exec.stepId, exec);
    }
  }

  const currentStepId = instance.currentStepId;
  const variables = (instance.variables ?? {}) as Record<string, Record<string, unknown>>;

  const stepEntries: StepEntry[] = [];
  let pastCurrentStep = false;

  for (const step of definition.steps) {
    if (step.type === 'terminal') continue;

    const executorType: StepEntry['executorType'] = step.executor ?? 'unknown';
    const execution = executionsByStep.get(step.id) ?? null;
    const stepVariables = variables[step.id] ?? null;

    let status: StepEntry['status'];
    if (pastCurrentStep) {
      status = 'pending';
    } else if (step.id === currentStepId) {
      status = 'running';
      pastCurrentStep = true;
    } else {
      const hasOutput = execution?.output !== null || stepVariables !== null;
      status = hasOutput ? 'completed' : 'pending';
    }
    if (step.id === currentStepId && instance.status === 'completed') {
      status = 'completed';
    }
    if (instance.status === 'completed' && currentStepId === null) {
      const hasOutput = execution?.output !== null || stepVariables !== null;
      status = hasOutput ? 'completed' : 'pending';
    }

    let stepInput: Record<string, unknown> | null = null;
    let stepOutput: Record<string, unknown> | null = null;
    if (executorType === 'agent' && execution !== null) {
      stepInput = execution.input;
      stepOutput = execution.output;
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
      execution,
    });
  }

  return {
    instanceId,
    definitionName: instance.definitionName,
    definitionVersion: instance.definitionVersion,
    instanceStatus: instance.status,
    currentStepId,
    steps: stepEntries,
  };
}
