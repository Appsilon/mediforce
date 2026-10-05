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
 * runnable version — or, when that version no longer has the step, the newest
 * live version that does, since the step's Evaluation rows outlive it there —
 * or in `version`, when given (`'runnable'` pins the runnable version, for a
 * call that builds a new version from it). The caller's right to act on it is
 * checked: `read` needs only to see the workflow, `edit` and `run` ask its
 * Access rows (ADR-0019). `run` gates what executes on the Step's behalf —
 * check code, a paid judge. An invisible workflow reads as missing, never as
 * forbidden.
 */
export async function loadEvaluatedStep(
  scope: CallerScope,
  ref: EvaluatedStep,
  verb: 'read' | 'edit' | 'run',
  version?: number | 'runnable',
): Promise<LoadedStep> {
  const definition = typeof version === 'number'
    ? await scope.workflowDefinitions.get(ref.namespace, ref.workflowName, version)
    : await definitionHoldingStep(scope, ref, version === 'runnable');
  if (definition === null) {
    throw new NotFoundError(`Workflow '${ref.workflowName}' v${String(version)} not found`);
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
    throw new ValidationError(`Step '${ref.stepId}' ${inlineMcpReason(inlineServers)}`);
  }
  if (verb === 'edit') await assertCallerMayEditWorkflow(scope, ref.namespace, ref.workflowName);
  if (verb === 'run') await assertCallerMayRunWorkflow(scope, ref.namespace, ref.workflowName);
  return { definition, step };
}

/** Why a step that declares MCP servers inline cannot be evaluated. */
export function inlineMcpReason(serverNames: readonly string[]): string {
  return `declares MCP servers inline (${serverNames.join(', ')}); move them onto its agent before evaluating it`;
}

/** The runnable version, or — unless `runnableOnly` — the newest live version holding the step when the runnable one lacks it. */
async function definitionHoldingStep(scope: CallerScope, ref: EvaluatedStep, runnableOnly: boolean): Promise<WorkflowDefinition> {
  const resolution = await resolveRunnableVersion(scope.workflowDefinitions, ref.namespace, ref.workflowName);
  if (resolution.ok === false) throw new NotFoundError(`Workflow '${ref.workflowName}' not found`);
  const holds = (definition: WorkflowDefinition) => definition.steps.some((candidate) => candidate.id === ref.stepId);
  if (runnableOnly || holds(resolution.def)) return resolution.def;
  const [newestHolding] = (await scope.workflowDefinitions.listVersions(ref.namespace, ref.workflowName))
    .filter((definition) => definition.archived !== true && definition.deleted !== true && holds(definition))
    .sort((left, right) => right.version - left.version);
  return newestHolding ?? resolution.def;
}

export function stepRef(row: EvaluatedStep): EvaluatedStep {
  return { namespace: row.namespace, workflowName: row.workflowName, stepId: row.stepId };
}

/** Whether a row belongs to this Step. */
export function isSameStep(row: EvaluatedStep, step: EvaluatedStep): boolean {
  return row.namespace === step.namespace && row.workflowName === step.workflowName && row.stepId === step.stepId;
}
