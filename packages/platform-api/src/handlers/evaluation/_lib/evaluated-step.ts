import {
  resolveRunnableVersion,
  type EvaluatedStep,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import { assertCallerMayEditWorkflow, assertCallerMayRunWorkflow } from '../../workflows/_access-gate';

export interface LoadedStep {
  readonly definition: WorkflowDefinition;
  readonly step: WorkflowStep;
}

/**
 * The agent Step an Evaluation call is about, as it stands in the workflow's
 * runnable version, with the caller's right to act on it checked: `read` needs
 * only to see the workflow, `edit` and `run` ask its Access rows (ADR-0019).
 * An invisible workflow reads as missing, never as forbidden.
 */
export async function loadEvaluatedStep(
  scope: CallerScope,
  ref: EvaluatedStep,
  verb: 'read' | 'edit' | 'run',
): Promise<LoadedStep> {
  const resolution = await resolveRunnableVersion(scope.workflowDefinitions, ref.namespace, ref.workflowName);
  if (!resolution.ok) throw new NotFoundError(`Workflow '${ref.workflowName}' not found`);
  const definition = await scope.workflowDefinitions.get(ref.namespace, ref.workflowName, resolution.def.version);
  if (definition === null) throw new NotFoundError(`Workflow '${ref.workflowName}' not found`);
  const step = definition.steps.find((candidate) => candidate.id === ref.stepId);
  if (step === undefined) {
    throw new NotFoundError(`Step '${ref.stepId}' not found in '${ref.workflowName}' v${definition.version}`);
  }
  if (step.executor !== 'agent') {
    throw new ValidationError(`Step '${ref.stepId}' is a ${step.executor} step; only agent steps are evaluated`);
  }
  if (verb === 'edit') await assertCallerMayEditWorkflow(scope, ref.namespace, ref.workflowName);
  if (verb === 'run') await assertCallerMayRunWorkflow(scope, ref.namespace, ref.workflowName);
  return { definition, step };
}

export function stepRef(row: EvaluatedStep): EvaluatedStep {
  return { namespace: row.namespace, workflowName: row.workflowName, stepId: row.stepId };
}
