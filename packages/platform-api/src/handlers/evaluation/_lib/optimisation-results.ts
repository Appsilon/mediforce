import {
  CHAMPION_VARIANT_ID,
  wilsonInterval,
  type EvalCase,
  type EvalOptimisation,
  type EvalRun,
} from '@mediforce/platform-core';
import type { OptimisationSplitResult, OptimisationVariantResult } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { casesOfRun, countedScores, mean, passedEveryCounted, trialScores } from './trial-scores';

function splitResult(caseCount: number, verdicts: readonly (boolean | null)[]): OptimisationSplitResult {
  const graded = verdicts.filter((verdict) => verdict !== null);
  const passes = graded.filter((verdict) => verdict === true).length;
  const interval = wilsonInterval(passes, graded.length);
  return {
    cases: caseCount,
    graded: graded.length,
    passes,
    passRate: graded.length === 0 ? null : passes / graded.length,
    wilsonLower: interval?.lower ?? null,
    wilsonUpper: interval?.upper ?? null,
  };
}

/** Higher first, an unknown rate last. */
function byRate(left: number | null, right: number | null): number {
  return (right ?? -1) - (left ?? -1);
}

/**
 * Each variant of an optimisation's Eval Run on its dev and its holdout cases.
 * The candidates are ranked by the Wilson lower bound of their holdout pass
 * rate: the job reflected on the dev cases, so a dev gain alone may be
 * overfitting, and the bound ranks a rate on fewer graded trials lower. The
 * dev pass rate breaks a tie — and ranks alone when the Dataset has no
 * holdout case — then the cheaper one comes first.
 */
export async function optimisationResults(
  scope: CallerScope,
  optimisation: EvalOptimisation,
  run: EvalRun,
): Promise<{ baseline: OptimisationVariantResult | null; ranking: Array<OptimisationVariantResult & { rank: number }> }> {
  const trials = await scope.evaluation.listTrials(run.id);
  const cases = await casesOfRun(scope, run);
  const splits = new Map([...cases].map(([caseId, evalCase]) => [caseId, evalCase?.split ?? null] as const));
  const verdicts = new Map(await Promise.all(trials.map(async (trial) => [
    trial.id,
    trial.status === 'scored' ? passedEveryCounted(run, countedScores(await trialScores(scope, run, trial)), cases.get(trial.caseId) ?? null) : null,
  ] as const)));

  const resultOf = (variantId: string, label: string, prompt: string | null): OptimisationVariantResult => {
    const ofVariant = trials.filter((trial) => trial.variantId === variantId);
    const onSplit = (split: EvalCase['split']) => splitResult(
      run.caseIds.filter((caseId) => splits.get(caseId) === split).length,
      ofVariant.filter((trial) => splits.get(trial.caseId) === split).map((trial) => verdicts.get(trial.id) ?? null),
    );
    return {
      variantId,
      label,
      prompt,
      dev: onSplit('dev'),
      holdout: onSplit('holdout'),
      meanCostUsd: mean(ofVariant.flatMap((trial) => trial.costUsd === null ? [] : [trial.costUsd])),
    };
  };

  const champion = run.variants.find((variant) => variant.id === CHAMPION_VARIANT_ID);
  const candidates = optimisation.candidates.flatMap((candidate) =>
    candidate.variantId === null ? [] : [resultOf(candidate.variantId, candidate.label, candidate.prompt)]);
  const ranked = [...candidates].sort((left, right) => byRate(left.holdout.wilsonLower, right.holdout.wilsonLower)
    || byRate(left.dev.passRate, right.dev.passRate)
    || (left.meanCostUsd ?? Number.MAX_VALUE) - (right.meanCostUsd ?? Number.MAX_VALUE));
  return {
    baseline: champion === undefined ? null : resultOf(champion.id, champion.label, null),
    ranking: ranked.map((result, index) => ({ ...result, rank: index + 1 })),
  };
}
