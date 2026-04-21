import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import type { StepExecution } from '@mediforce/platform-core';

/**
 * GET /api/processes/:instanceId/steps
 *
 * Returns step-by-step input/output for every step in the process definition.
 * For agent steps: data comes from step execution records.
 * For human steps: data comes from instance.variables[stepId].
 *
 * Each entry includes:
 *   - stepId, name, type, executorType
 *   - status: completed | running | pending
 *   - input: what the engine passed to this step (null if not yet reached)
 *   - output: what the step produced (null if still running or not yet reached)
 *   - execution: full StepExecution record (agent steps only)
 */

interface StepEntry {
  stepId: string;
  name: string;
  type: string;
  executorType: string;
  status: 'completed' | 'running' | 'pending';
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  execution: StepExecution | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  try {
    const { instanceId } = await params;
    const { instanceRepo, processRepo } = getPlatformServices();

    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const definition = await processRepo.getProcessDefinition(
      instance.definitionName,
      instance.definitionVersion,
    );
    if (!definition) {
      return NextResponse.json(
        { error: 'Process definition not found' },
        { status: 404 },
      );
    }

    const config = await processRepo.getProcessConfig(
      instance.definitionName,
      instance.configName ?? '',
      instance.configVersion ?? '',
    );

    // Fetch all step executions in one query
    const executions = await instanceRepo.getStepExecutions(instanceId);

    // Index executions by stepId (latest per step)
    const executionsByStep = new Map<string, StepExecution>();
    for (const exec of executions) {
      const existing = executionsByStep.get(exec.stepId);
      if (!existing || exec.startedAt > existing.startedAt) {
        executionsByStep.set(exec.stepId, exec);
      }
    }

    // Determine which steps have been reached by walking the definition order
    const currentStepId = instance.currentStepId;
    const variables = (instance.variables ?? {}) as Record<string, Record<string, unknown>>;

    // Build ordered list of non-terminal steps
    const stepEntries: StepEntry[] = [];
    let pastCurrentStep = false;

    for (const step of definition.steps) {
      if (step.type === 'terminal') continue;

      const stepConfig = config?.stepConfigs.find((sc) => sc.stepId === step.id);
      const executorType = stepConfig?.executorType ?? 'unknown';
      const execution = executionsByStep.get(step.id) ?? null;
      const stepVariables = variables[step.id] ?? null;

      // Determine step status
      let status: StepEntry['status'];
      if (pastCurrentStep) {
        status = 'pending';
      } else if (step.id === currentStepId) {
        // Current step — could be running or waiting
        status = 'running';
        pastCurrentStep = true;
      } else {
        // Before current step — check if we have output
        const hasOutput = execution?.output !== null || stepVariables !== null;
        status = hasOutput ? 'completed' : 'pending';
      }

      // If instance is completed/failed and this is the current step, mark accordingly
      if (step.id === currentStepId && instance.status === 'completed') {
        status = 'completed';
      }
      // If instance completed and currentStepId is null, all steps are done
      if (instance.status === 'completed' && currentStepId === null) {
        const hasOutput = execution?.output !== null || stepVariables !== null;
        status = hasOutput ? 'completed' : 'pending';
      }

      // Build input/output based on executor type
      let input: Record<string, unknown> | null = null;
      let output: Record<string, unknown> | null = null;

      if (executorType === 'agent' && execution) {
        input = execution.input;
        output = execution.output;
      } else if (executorType === 'human') {
        // Human steps: the step definition describes what's expected,
        // the output is whatever was submitted (stored in variables)
        input = step.ui ? { ui: step.ui } : null;
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

    return NextResponse.json({
      instanceId,
      definitionName: instance.definitionName,
      definitionVersion: instance.definitionVersion,
      instanceStatus: instance.status,
      currentStepId,
      steps: stepEntries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
