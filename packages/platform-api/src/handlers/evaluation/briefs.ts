import type { z } from 'zod';
import type {
  GetEvaluationBriefInputSchema,
  GetEvaluationBriefOutput,
  SetEvaluationBriefInputSchema,
  SetEvaluationBriefOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';

/** The Step's current Evaluation Brief and every earlier version (D16). */
export async function getEvaluationBrief(
  input: z.output<typeof GetEvaluationBriefInputSchema>,
  scope: CallerScope,
): Promise<GetEvaluationBriefOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const versions = await scope.evaluation.listBriefs(stepRef(input));
  return { brief: versions[0] ?? null, versions };
}

/** Writes a new Brief version — by a person, or a person accepting the assistant's draft. */
export async function setEvaluationBrief(
  input: z.output<typeof SetEvaluationBriefInputSchema>,
  scope: CallerScope,
): Promise<SetEvaluationBriefOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  const [current] = await scope.evaluation.listBriefs(step);
  const brief = await scope.evaluation.appendBrief({
    ...step,
    version: (current?.version ?? 0) + 1,
    text: input.text,
    origin: input.origin,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'evaluation_brief.updated',
    description: `Evaluation Brief v${brief.version} for step '${step.stepId}' of '${step.workflowName}'`,
    namespace: step.namespace,
    entityType: 'evaluation_brief',
    entityId: `${step.workflowName}/${step.stepId}`,
    inputSnapshot: { ...step, text: brief.text, origin: brief.origin },
    outputSnapshot: { version: brief.version },
    basis: 'Evaluation Brief states the Step\'s context of use (ADR-0023 D16)',
  });
  return { brief };
}
