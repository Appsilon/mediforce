import {
  JUDGE_PASS_VALUE,
  caseReliability,
  wilsonInterval,
  type EvalRun,
  type EvalRunReport,
  type EvalTrial,
  type Score,
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

/**
 * The Eval Run report (ADR-0023 D10), computed from the Scores its trials
 * received — so its numbers are the Scores' numbers by construction. Per
 * Evaluator: pass rate with its Wilson 95% interval, pass@k, pass^k and
 * flakiness over cases; a trial the check could not grade counts as an error,
 * not a failure. Over cases, an ungraded or failed trial still counts toward
 * k, so it can lower pass@k and pass^k but never lift them.
 */
export async function buildEvalRunReport(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<EvalRunReport> {
  const scores = await trialScores(scope, run, trials);
  const scored = trials.filter((trial) => trial.status === 'scored');
  const attempted = trials.filter((trial) => trial.status === 'scored' || trial.status === 'failed');

  const evaluators = run.evaluators.map((evaluator) => {
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
      const passed = score.value >= JUDGE_PASS_VALUE;
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

  const costs = trials.flatMap((trial) => (trial.costUsd === null ? [] : [trial.costUsd]));
  const durations = trials.flatMap((trial) => (trial.durationMs === null ? [] : [trial.durationMs]));
  return {
    k: run.trialsPerCase,
    trials: {
      total: trials.length,
      scored: scored.length,
      failed: trials.filter((trial) => trial.status === 'failed').length,
      skipped: trials.filter((trial) => trial.status === 'skipped').length,
      inProgress: trials.filter((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring').length,
    },
    evaluators,
    costUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: mean(costs),
    inputTokens: trials.reduce((sum, trial) => sum + (trial.inputTokens ?? 0), 0),
    outputTokens: trials.reduce((sum, trial) => sum + (trial.outputTokens ?? 0), 0),
    meanDurationMs: mean(durations),
    maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
  };
}
