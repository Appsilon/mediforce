import {
  isEmptyVariantPatch,
  variantPatchProblem,
  type EvaluatedStep,
  type StepVariantPatch,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { exampleCasesProblem } from './example-cases';

/**
 * Why a variant patch cannot be applied to the Step, or null (ADR-0023 D5,
 * D12): it changes nothing, moves an external skills repository the workflow
 * does not have, restricts MCP servers the Step's agent does not bind, or
 * brings few-shot examples from cases it may not use.
 */
export async function stepPatchProblem(
  scope: CallerScope,
  step: EvaluatedStep,
  definition: WorkflowDefinition,
  workflowStep: WorkflowStep,
  patch: StepVariantPatch,
): Promise<string | null> {
  if (isEmptyVariantPatch(patch)) return 'the patch changes nothing about the step';
  const problem = variantPatchProblem(definition, patch);
  if (problem !== null) return problem;
  if (patch.mcpRestrictions !== undefined) {
    const agent = workflowStep.agentId === undefined ? null : await scope.agentDefinitions.getById(workflowStep.agentId);
    const agentServers = Object.keys(agent?.mcpServers ?? {});
    const unknownServers = Object.keys(patch.mcpRestrictions).filter((name) => agentServers.includes(name) === false);
    if (unknownServers.length > 0) {
      return `it restricts MCP servers the step's agent does not bind: ${unknownServers.join(', ')}`;
    }
  }
  return exampleCasesProblem(scope, step, patch.examples ?? []);
}
