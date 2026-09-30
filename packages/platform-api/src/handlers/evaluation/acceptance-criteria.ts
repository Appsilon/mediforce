import type { z } from 'zod';
import type {
  GetAcceptanceCriteriaInput,
  GetAcceptanceCriteriaOutput,
  SetAcceptanceCriteriaInputSchema,
  SetAcceptanceCriteriaOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';

/** The Step's current Acceptance Criteria and every earlier version (D10). */
export async function getAcceptanceCriteria(
  input: GetAcceptanceCriteriaInput,
  scope: CallerScope,
): Promise<GetAcceptanceCriteriaOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const versions = await scope.evaluation.listAcceptanceCriteria(stepRef(input));
  return { criteria: versions[0] ?? null, versions };
}

/**
 * Writes new Acceptance Criteria as a version — by a person, or a person
 * accepting the assistant's proposal. An Eval Run freezes the version current
 * when it is prepared, so changing them never rejudges a run.
 */
export async function setAcceptanceCriteria(
  input: z.output<typeof SetAcceptanceCriteriaInputSchema>,
  scope: CallerScope,
): Promise<SetAcceptanceCriteriaOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  const [current] = await scope.evaluation.listAcceptanceCriteria(step);
  const criteria = await scope.evaluation.appendAcceptanceCriteria({
    ...step,
    version: (current?.version ?? 0) + 1,
    criteria: input.criteria,
    origin: input.origin,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'acceptance_criteria.updated',
    description: `Acceptance Criteria v${criteria.version} for step '${step.stepId}' of '${step.workflowName}'`,
    namespace: step.namespace,
    entityType: 'acceptance_criteria',
    entityId: `${step.workflowName}/${step.stepId}`,
    inputSnapshot: { ...step, criteria: criteria.criteria, origin: criteria.origin },
    outputSnapshot: { version: criteria.version },
    basis: 'Acceptance Criteria are set before the Eval Runs judged against them (ADR-0023 D10)',
  });
  return { criteria };
}
