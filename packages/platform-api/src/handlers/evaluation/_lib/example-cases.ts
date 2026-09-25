import type { AgentExample, EvaluatedStep } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { isSameStep } from './evaluated-step';

/**
 * Why a Step's few-shot examples cannot be used, or null (ADR-0023 D12). An
 * example taken from an Eval Case cites it by `caseId`: a live case of this
 * same Step, never a holdout one — holdout cases are never offered as examples.
 */
export async function exampleCasesProblem(
  scope: CallerScope,
  step: EvaluatedStep,
  examples: readonly AgentExample[],
): Promise<string | null> {
  for (const { caseId } of examples) {
    if (caseId === undefined) continue;
    const evalCase = await scope.evaluation.getCase(caseId);
    if (evalCase === null || isSameStep(evalCase, step) === false) {
      return `Example case '${caseId}' is not an Eval Case of step '${step.stepId}'`;
    }
    if (evalCase.archived === true) return `Example case '${evalCase.name}' is archived`;
    if (evalCase.split === 'holdout') {
      return `Example case '${evalCase.name}' is a holdout case — holdout cases are never offered as examples`;
    }
  }
  return null;
}
