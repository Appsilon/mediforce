import {
  inlineMcpServerNames,
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
 * runnable version — or in `version`, when given — with the caller's right to
 * act on it checked: `read` needs only to see the workflow, `edit` and `run`
 * ask its Access rows (ADR-0019). `run` gates what executes on the Step's
 * behalf — check code, a paid judge. An invisible workflow reads as missing,
 * never as forbidden.
 */
export async function loadEvaluatedStep(
  scope: CallerScope,
  ref: EvaluatedStep,
  verb: 'read' | 'edit' | 'run',
  version?: number,
): Promise<LoadedStep> {
  let pinned = version;
  if (pinned === undefined) {
    const resolution = await resolveRunnableVersion(scope.workflowDefinitions, ref.namespace, ref.workflowName);
    if (!resolution.ok) throw new NotFoundError(`Workflow '${ref.workflowName}' not found`);
    pinned = resolution.def.version;
  }
  const definition = await scope.workflowDefinitions.get(ref.namespace, ref.workflowName, pinned);
  if (definition === null) {
    throw new NotFoundError(`Workflow '${ref.workflowName}'${version === undefined ? '' : ` v${version}`} not found`);
  }
  const step = definition.steps.find((candidate) => candidate.id === ref.stepId);
  if (step === undefined) {
    throw new NotFoundError(`Step '${ref.stepId}' not found in '${ref.workflowName}' v${definition.version}`);
  }
  if (step.executor !== 'agent') {
    throw new ValidationError(`Step '${ref.stepId}' is a ${step.executor} step; only agent steps are evaluated`);
  }
  const inlineServers = inlineMcpServerNames(step);
  if (inlineServers.length > 0) {
    throw new ValidationError(
      `Step '${ref.stepId}' declares MCP servers inline (${inlineServers.join(', ')}); `
      + 'move them onto its agent before evaluating it',
    );
  }
  if (verb === 'edit') await assertCallerMayEditWorkflow(scope, ref.namespace, ref.workflowName);
  if (verb === 'run') await assertCallerMayRunWorkflow(scope, ref.namespace, ref.workflowName);
  return { definition, step };
}

export function stepRef(row: EvaluatedStep): EvaluatedStep {
  return { namespace: row.namespace, workflowName: row.workflowName, stepId: row.stepId };
}
