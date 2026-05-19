import type {
  ProcessInstanceRepository,
  ProcessRepository,
  StepExecution,
} from '@mediforce/platform-core';
import { callerCanAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetProcessStepsInput,
  GetProcessStepsOutput,
  StepEntry,
} from '../../contract/processes.js';

export interface GetProcessStepsDeps {
  instanceRepo: ProcessInstanceRepository;
  processRepo: ProcessRepository;
}

/**
 * Derived per-step view combining workflow-definition order, the latest
 * step execution per step, and `instance.variables[stepId]` for human
 * steps. Algorithm ported verbatim from the pre-migration Next.js route
 * (`packages/platform-ui/src/app/api/processes/[instanceId]/steps/route.ts`
 * on `main`) — same status-derivation rules, same input/output shaping.
 *
 * Namespace gating: api-key callers always pass, user callers must be
 * members of the instance's namespace. Access denial surfaces as 404 (not
 * 403) — a non-member caller cannot distinguish "exists but denied" from
 * "doesn't exist". The namespace check runs AFTER the instance is fetched
 * but BEFORE the rest of the algorithm.
 */
export async function getProcessSteps(
  input: GetProcessStepsInput,
  deps: GetProcessStepsDeps,
  caller: CallerIdentity,
): Promise<GetProcessStepsOutput> {
  const { instanceId } = input;
  const { instanceRepo, processRepo } = deps;

  const instance = await instanceRepo.getById(instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${instanceId} not found`);
  }

  if (!callerCanAccess(caller, instance.namespace)) {
    throw new NotFoundError(`Process instance ${instanceId} not found`);
  }

  // Load workflow definition. `definitionVersion` is stored as a string on
  // the instance; `getWorkflowDefinition` takes a number — non-numeric
  // strings have no matching definition and surface as 404.
  const versionNum = Number.parseInt(instance.definitionVersion, 10);
  const definition = Number.isFinite(versionNum)
    ? await processRepo.getWorkflowDefinition(
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

    const executorType: StepEntry['executorType'] = step.executor ?? 'unknown';
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
