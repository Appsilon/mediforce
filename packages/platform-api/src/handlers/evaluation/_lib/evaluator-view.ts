import { evaluatorTrust, type Evaluator, type EvaluatorTrust } from '@mediforce/platform-core';
import type { EvaluatorProduction, EvaluatorView } from '../../../contract/evaluation';
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
    production: evaluatorProduction(evaluator, trust),
  };
}

/** A flagged Evaluator scores production runs only while it is live and its latest version counts (D9, D13). */
export function evaluatorProduction(evaluator: Evaluator, trust: EvaluatorTrust): EvaluatorProduction {
  if (evaluator.runInProduction === false) return { active: false };
  if (evaluator.archived === true) return { active: false, reason: 'archived' };
  if (trust.trusted === false) return { active: false, reason: `in production once it counts (${trust.reason})` };
  return { active: true };
}

export async function loadEvaluator(scope: CallerScope, evaluatorId: string): Promise<Evaluator> {
  const evaluator = await scope.evaluation.getEvaluator(evaluatorId);
  if (evaluator === null) throw new NotFoundError(`Evaluator '${evaluatorId}' not found`);
  return evaluator;
}
