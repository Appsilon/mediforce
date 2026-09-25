import {
  EVAL_SUITES,
  calibrateConfidence,
  caseReliability,
  judgeAcceptanceCriteria,
  recommendControl,
  wilsonInterval,
  type AcceptanceCriterionVerdict,
  type BuiltinCheckName,
  type ConfidenceOutcome,
  type EvalRun,
  type EvalRunEvaluatorReport,
  type EvalRunReport,
  type EvalRunVariantReport,
  type EvalSuite,
  type EvalSuiteReport,
  type EvalTrial,
  type EvalVariant,
  type Score,
  type VariantComparison,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { isPass, scoresOfTrial } from './trial-scores';

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

const SUITE_OF_BUILTIN: Record<BuiltinCheckName, EvalSuite> = {
  injection_ignored: 'prompt_injection',
  result_stable: 'robustness',
  phi_leak: 'phi_leak',
};

/** Pass rates by red-team and robustness suite: each suite sums the run's Evaluators that run its built-in check. */
function suiteReports(run: EvalRun, evaluators: readonly EvalRunEvaluatorReport[]): EvalSuiteReport[] {
  return EVAL_SUITES.flatMap((suite) => {
    const members = run.evaluators.flatMap((frozen) =>
      frozen.builtin !== undefined && SUITE_OF_BUILTIN[frozen.builtin] === suite
        ? evaluators.filter((report) => report.evaluatorId === frozen.evaluatorId)
        : []);
    if (members.length === 0) return [];
    const passes = members.reduce((sum, report) => sum + report.passes, 0);
    const failures = members.reduce((sum, report) => sum + report.failures, 0);
    const interval = wilsonInterval(passes, passes + failures);
    return [{
      suite,
      evaluators: members.map((report) => report.name),
      passes,
      failures,
      errors: members.reduce((sum, report) => sum + report.errors, 0),
      passRate: passes + failures === 0 ? null : passes / (passes + failures),
      wilsonLower: interval?.lower ?? null,
      wilsonUpper: interval?.upper ?? null,
    }];
  });
}

/**
 * A scored trial that reported a confidence, against whether its output
 * passed every counted Evaluator — the pairs confidence is calibrated on. A
 * trial some counted Evaluator could not grade says nothing: a missing Score
 * is not a pass.
 */
function confidenceOutcomes(run: EvalRun, trials: readonly EvalTrial[], scores: ReadonlyMap<string, Score[]>): ConfidenceOutcome[] {
  const counted = new Set(run.evaluators.filter((evaluator) => evaluator.counted === true).map((evaluator) => evaluator.evaluatorId));
  if (counted.size === 0) return [];
  return trials.flatMap((trial) => {
    if (trial.status !== 'scored' || trial.confidence === null) return [];
    const graded = (scores.get(trial.id) ?? []).filter((score) => score.evaluatorId !== null && counted.has(score.evaluatorId));
    const gradedBy = new Set(graded.map((score) => score.evaluatorId));
    return gradedBy.size < counted.size ? [] : [{ confidence: trial.confidence, passed: graded.every(isPass) }];
  });
}

/**
 * A criterion is met on the whole frozen Dataset or not at all: while some
 * trial failed or was skipped, one the scored trials reached is not judged.
 */
function judgedOnEveryTrial(verdicts: AcceptanceCriterionVerdict[], counts: EvalRunReport['trials']): AcceptanceCriterionVerdict[] {
  const unscored = counts.failed + counts.skipped;
  if (unscored === 0) return verdicts;
  return verdicts.map((verdict): AcceptanceCriterionVerdict => (verdict.status === 'met'
    ? { ...verdict, status: 'not_evaluable', reason: `${unscored} of ${counts.total} trials failed or were skipped, so the Dataset was not evaluated in full` }
    : verdict));
}

function variantReport(
  run: EvalRun,
  variant: EvalVariant,
  trials: readonly EvalTrial[],
  scores: ReadonlyMap<string, Score[]>,
): EvalRunVariantReport {
  const evaluators = evaluatorReports(run, trials, scores);
  const counts = trialCounts(trials);
  const criteria = judgedOnEveryTrial(judgeAcceptanceCriteria(run.acceptanceCriteria, evaluators), counts);
  const outcomes = confidenceOutcomes(run, trials, scores);
  // Routing is recommended on a variant's finished results only.
  const finished = counts.inProgress === 0 && counts.scored > 0;
  const costs = trials.flatMap((trial) => (trial.costUsd === null ? [] : [trial.costUsd]));
  const durations = trials.flatMap((trial) => (trial.durationMs === null ? [] : [trial.durationMs]));
  return {
    ...variant,
    trials: counts,
    evaluators,
    suites: suiteReports(run, evaluators),
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
