import { evaluatorTrust, type Evaluator } from '@mediforce/platform-core';
import type { EvaluatorView } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError } from '../../../errors';

export async function evaluatorView(scope: CallerScope, evaluator: Evaluator): Promise<EvaluatorView> {
  const versions = await scope.evaluation.listEvaluatorVersions(evaluator.id);
  const latest = versions[versions.length - 1];
  if (latest === undefined) throw new NotFoundError(`Evaluator '${evaluator.id}' has no versions`);
  const trust = evaluatorTrust(latest);
  return {
    ...evaluator,
    latest,
    versions,
    trust: trust.trusted ? { trusted: true } : { trusted: false, reason: trust.reason },
  };
}

export async function loadEvaluator(scope: CallerScope, evaluatorId: string): Promise<Evaluator> {
  const evaluator = await scope.evaluation.getEvaluator(evaluatorId);
  if (evaluator === null) throw new NotFoundError(`Evaluator '${evaluatorId}' not found`);
  return evaluator;
}
