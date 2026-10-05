import type { ApproveEvaluatorSourceInput, EvaluatorOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { resolveTargetUid } from '../_helpers';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { evaluatorView, loadEvaluator } from './_lib/evaluator-view';
import { appendEvaluationAudit } from './_lib/audit';

/**
 * A person approves one version of a `code` Evaluator's source (D9) — the
 * approval is what lets it count. There is deliberately no assistant tool
 * for this (D15): the Evaluation Assistant may write check code, never vouch
 * for it.
 */
export async function approveEvaluatorSource(
  input: ApproveEvaluatorSourceInput,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const approvedBy = resolveTargetUid(input, scope, 'approval', 'approve an Evaluator\'s source');
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluatedStep(scope, stepRef(evaluator), 'edit');
  const view = await evaluatorView(scope, evaluator);
  const version = view.versions.find((candidate) => candidate.version === input.version);
  if (version === undefined) throw new NotFoundError(`Evaluator '${evaluator.name}' has no version ${input.version}`);
  if (version.check.kind !== 'code') {
    throw new ValidationError(`Only a code check's source is approved; v${input.version} is a ${version.check.kind} check`);
  }

  const approval = { approvedBy, approvedAt: new Date().toISOString() };
  await scope.evaluation.setSourceApproval(evaluator, input.version, approval);
  await appendEvaluationAudit(scope, {
    action: 'evaluator.source_approved',
    description: `Source of Evaluator '${evaluator.name}' v${input.version} approved by ${approvedBy}`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { version: input.version, source: version.check.source, runtime: version.check.runtime },
    outputSnapshot: approval,
    basis: 'A code Evaluator counts only after a recorded human approval of its source (ADR-0023 D9)',
  });
  return { evaluator: await evaluatorView(scope, evaluator) };
}
