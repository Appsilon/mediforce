import type {
  ProcessInstanceRepository,
  ProcessRepository,
  StepExecution,
} from '@mediforce/platform-core';
import type {
  GetProcessStepsInput,
  GetProcessStepsOutput,
  StepEntry,
} from '../../contract/processes.js';
import { NotFoundError } from '../../errors.js';

export interface GetProcessStepsDeps {
  instanceRepo: ProcessInstanceRepository;
  processRepo: ProcessRepository;
}

/**
 * Pure handler: derived per-step view combining definition order, latest
 * step execution per step, and `instance.variables[stepId]` for human
 * steps.
 *
 * Ported verbatim from the Next.js route that preceded this handler — same
 * status-derivation rules, same input/output shaping. No behavioural
 * changes; just the dependency injection + `NotFoundError` for missing
 * instance or definition.
 */
export async function getProcessSteps(
  input: GetProcessStepsInput,
  deps: GetProcessStepsDeps,
): Promise<GetProcessStepsOutput> {
  const { instanceId } = input;
  const { instanceRepo, processRepo } = deps;

  const instance = await instanceRepo.getById(instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${instanceId} not found`);
  }

  const definition = await processRepo.getProcessDefinition(
    instance.definitionName,
    instance.definitionVersion,
  );
  if (definition === null) {
    throw new NotFoundError(
      `Process definition ${instance.definitionName}@${instance.definitionVersion} not found`,
    );
  }

  const config = await processRepo.getProcessConfig(
    instance.definitionName,
    instance.configName ?? '',
    instance.configVersion ?? '',
  );

  const executions = await instanceRepo.getStepExecutions(instanceId);

  // Latest execution per stepId.
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

    const stepConfig = config?.stepConfigs.find((sc) => sc.stepId === step.id);
    const executorType = stepConfig?.executorType ?? 'unknown';
    const execution = executionsByStep.get(step.id) ?? null;
    const stepVariables = variables[step.id] ?? null;

    // Status derivation — identical to the pre-migration route.
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

    let input: Record<string, unknown> | null = null;
    let output: Record<string, unknown> | null = null;
    if (executorType === 'agent' && execution !== null) {
      input = execution.input;
      output = execution.output;
    } else if (executorType === 'human') {
      input = step.ui !== undefined ? { ui: step.ui } : null;
      output = stepVariables;
    }

    stepEntries.push({
      stepId: step.id,
      name: step.name,
      type: step.type,
      executorType,
      status,
      input,
      output,
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
