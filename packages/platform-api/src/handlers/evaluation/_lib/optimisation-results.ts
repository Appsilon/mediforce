import {
  CHAMPION_VARIANT_ID,
  wilsonInterval,
  type EvalCase,
  type EvalOptimisation,
  type EvalRun,
  type EvalTrial,
} from '@mediforce/platform-core';
import type { OptimisationSplitResult, OptimisationVariantResult } from '../../../contract/evaluation';
import type { CallerScope } from '../../../repositories/index';
import { isPass, scoresOfTrial } from './trial-scores';

/** Whether a scored trial passed every counted Evaluator; null when one of them did not grade it. */
async function trialVerdict(scope: CallerScope, run: EvalRun, trial: EvalTrial): Promise<boolean | null> {
  if (trial.status !== 'scored') return null;
  const scores = await scoresOfTrial(scope, run, trial);
  const counted = run.evaluators.filter((evaluator) => evaluator.counted);
  const graded = counted.map((evaluator) => scores.find((score) => score.evaluatorId === evaluator.evaluatorId));
  if (counted.length === 0 || graded.some((score) => score === undefined)) return null;
  return graded.every((score) => isPass(score!));
}

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

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Higher first, an unknown rate last. */
function byRate(left: number | null, right: number | null): number {
  return (right ?? -1) - (left ?? -1);
}

/**
 * Each variant of an optimisation's Eval Run on its dev and its holdout cases.
 * The candidates are ranked by dev pass rate, as GEPA selects on the data it
 * reflected on; the holdout rate breaks a tie and shows whether a gain
 * generalises; then the cheaper one comes first.
 */
export async function optimisationResults(
  scope: CallerScope,
  optimisation: EvalOptimisation,
  run: EvalRun,
): Promise<{ baseline: OptimisationVariantResult | null; ranking: Array<OptimisationVariantResult & { rank: number }> }> {
  const trials = await scope.evaluation.listTrials(run.id);
  const splits = new Map<string, EvalCase['split'] | null>(await Promise.all(run.caseIds.map(async (caseId) =>
    [caseId, (await scope.evaluation.getCase(caseId))?.split ?? null] as const)));
  const verdicts = new Map(await Promise.all(trials.map(async (trial) => [trial.id, await trialVerdict(scope, run, trial)] as const)));

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
  const ranked = [...candidates].sort((left, right) => byRate(left.dev.passRate, right.dev.passRate)
    || byRate(left.holdout.passRate, right.holdout.passRate)
    || (left.meanCostUsd ?? Number.MAX_VALUE) - (right.meanCostUsd ?? Number.MAX_VALUE));
  return {
    baseline: champion === undefined ? null : resultOf(champion.id, champion.label, null),
    ranking: ranked.map((result, index) => ({ ...result, rank: index + 1 })),
  };
}
