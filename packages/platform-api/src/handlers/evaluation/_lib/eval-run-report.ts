import {
  JUDGE_PASS_VALUE,
  calibrateConfidence,
  caseReliability,
  judgeAcceptanceCriteria,
  recommendControl,
  wilsonInterval,
  type ConfidenceOutcome,
  type EvalRun,
  type EvalRunEvaluatorReport,
  type EvalRunReport,
  type EvalRunVariantReport,
  type EvalTrial,
  type EvalVariant,
  type Score,
  type VariantComparison,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { scoresOfTrial } from './trial-scores';

/** The Scores the run's Evaluators gave its scored trials, by trial id. */
async function trialScores(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<Map<string, Score[]>> {
  const scored = trials.filter((trial) => trial.status === 'scored');
  return new Map(await Promise.all(scored.map(async (trial) => [trial.id, await scoresOfTrial(scope, run, trial)] as const)));
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trialCounts(trials: readonly EvalTrial[]): EvalRunReport['trials'] {
  return {
    total: trials.length,
    scored: trials.filter((trial) => trial.status === 'scored').length,
    failed: trials.filter((trial) => trial.status === 'failed').length,
    skipped: trials.filter((trial) => trial.status === 'skipped').length,
    inProgress: trials.filter((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring').length,
  };
}

function isPass(score: Score): boolean {
  return score.value >= JUDGE_PASS_VALUE;
}

/**
 * Per Evaluator over one variant's trials: pass rate with its Wilson 95%
 * interval, pass@k, pass^k and flakiness over cases; a trial the check could
 * not grade counts as an error, not a failure. Over cases, an ungraded or
 * failed trial still counts toward k, so it can lower pass@k and pass^k but
 * never lift them.
 */
function evaluatorReports(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, Score[]>): EvalRunEvaluatorReport[] {
  const attempted = trials.filter((trial) => trial.status === 'scored' || trial.status === 'failed');
  return run.evaluators.map((evaluator) => {
    let passes = 0;
    let failures = 0;
    let errors = 0;
    const outcomesByCase = new Map<string, (boolean | null)[]>();
    const recordOutcome = (caseId: string, passed: boolean | null) =>
      outcomesByCase.set(caseId, [...(outcomesByCase.get(caseId) ?? []), passed]);
    for (const trial of attempted) {
      if (trial.status === 'failed') {
        recordOutcome(trial.caseId, null);
        continue;
      }
      const score = scores.get(trial.id)?.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
      if (score === undefined) {
        errors += 1;
        recordOutcome(trial.caseId, null);
        continue;
      }
      const passed = isPass(score);
      if (passed) passes += 1;
      else failures += 1;
      recordOutcome(trial.caseId, passed);
    }
    const graded = passes + failures;
    const interval = wilsonInterval(passes, graded);
    const reliability = caseReliability(outcomesByCase);
    return {
      ...evaluator,
      passes,
      failures,
      errors,
      passRate: graded === 0 ? null : passes / graded,
      wilsonLower: interval?.lower ?? null,
      wilsonUpper: interval?.upper ?? null,
      passAtK: reliability?.passAtK ?? null,
      passHatK: reliability?.passHatK ?? null,
      flakiness: reliability?.flakiness ?? null,
    };
  });
}

/**
 * A scored trial that reported a confidence, against whether its output
 * passed every counted Evaluator that graded it — the pairs confidence is
 * calibrated on. A trial no counted Evaluator graded says nothing.
 */
function confidenceOutcomes(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, Score[]>): ConfidenceOutcome[] {
  const counted = new Set(run.evaluators.filter((evaluator) => evaluator.counted === true).map((evaluator) => evaluator.evaluatorId));
  return trials.flatMap((trial) => {
    if (trial.status !== 'scored' || trial.confidence === null) return [];
    const graded = (scores.get(trial.id) ?? []).filter((score) => score.evaluatorId !== null && counted.has(score.evaluatorId));
    return graded.length === 0 ? [] : [{ confidence: trial.confidence, passed: graded.every(isPass) }];
  });
}

function variantReport(
  run: EvalRun,
  variant: EvalVariant,
  trials: readonly EvalTrial[],
  scores: ReadonlyMap<string, Score[]>,
): EvalRunVariantReport {
  const evaluators = evaluatorReports(run, trials, scores);
  const criteria = judgeAcceptanceCriteria(run.acceptanceCriteria, evaluators);
  const outcomes = confidenceOutcomes(run, trials, scores);
  const counts = trialCounts(trials);
  // Routing is recommended on a variant's finished results only.
  const finished = counts.inProgress === 0 && counts.scored > 0;
  const costs = trials.flatMap((trial) => (trial.costUsd === null ? [] : [trial.costUsd]));
  const durations = trials.flatMap((trial) => (trial.durationMs === null ? [] : [trial.durationMs]));
  return {
    ...variant,
    trials: counts,
    evaluators,
    criteria,
    confidence: calibrateConfidence(outcomes),
    recommendation: finished ? recommendControl(outcomes, criteria) : null,
    costUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    inputTokens: trials.reduce((sum, trial) => sum + (trial.inputTokens ?? 0), 0),
    outputTokens: trials.reduce((sum, trial) => sum + (trial.outputTokens ?? 0), 0),
    meanDurationMs: mean(durations),
    maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
  };
}

function difference(challenger: number | null, champion: number | null): number | null {
  return challenger === null || champion === null ? null : challenger - champion;
}

/**
 * A challenger against the champion, Evaluator by Evaluator: `better` or
 * `worse` only when their Wilson 95% intervals do not overlap.
 */
function compare(champion: EvalRunVariantReport, challenger: EvalRunVariantReport): VariantComparison {
  return {
    variantId: challenger.id,
    evaluators: challenger.evaluators.map((result) => {
      const baseline = champion.evaluators.find((candidate) => candidate.evaluatorId === result.evaluatorId)!;
      const separated = result.wilsonLower !== null && baseline.wilsonUpper !== null && result.wilsonLower > baseline.wilsonUpper;
      const behind = result.wilsonUpper !== null && baseline.wilsonLower !== null && result.wilsonUpper < baseline.wilsonLower;
      return {
        evaluatorId: result.evaluatorId,
        name: result.name,
        championPassRate: baseline.passRate,
        challengerPassRate: result.passRate,
        delta: difference(result.passRate, baseline.passRate),
        verdict: separated ? 'better' : behind ? 'worse' : 'no_clear_difference',
      };
    }),
    meanCostDeltaUsd: difference(challenger.meanCostUsd, champion.meanCostUsd),
    meanDurationDeltaMs: difference(challenger.meanDurationMs, champion.meanDurationMs),
  };
}

/**
 * The Eval Run report (ADR-0023 D5, D10), computed from the Scores its trials
 * received — so its numbers are the Scores' numbers by construction. Per
 * variant: every Evaluator's results, the verdict on each Acceptance
 * Criterion, how the agent's confidence matched its pass rate and what that
 * recommends for routing, and what the variant cost. Then every challenger
 * against the champion.
 */
export async function buildEvalRunReport(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<EvalRunReport> {
  const scores = await trialScores(scope, run, trials);
  const variants = run.variants.map((variant) =>
    variantReport(run, variant, trials.filter((trial) => trial.variantId === variant.id), scores));
  const [champion, ...challengers] = variants;
  return {
    k: run.trialsPerCase,
    trials: trialCounts(trials),
    variants,
    comparison: champion === undefined ? [] : challengers.map((challenger) => compare(champion, challenger)),
    costUsd: trials.reduce((sum, trial) => sum + (trial.costUsd ?? 0), 0),
    inputTokens: trials.reduce((sum, trial) => sum + (trial.inputTokens ?? 0), 0),
    outputTokens: trials.reduce((sum, trial) => sum + (trial.outputTokens ?? 0), 0),
  };
}
