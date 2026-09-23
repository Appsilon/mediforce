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

/** The Scores the run's Evaluators gave its trials, by trial id. */
async function trialScores(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<Map<string, Score[]>> {
  const byTrial = new Map<string, Score[]>();
  await Promise.all(trials.map(async (trial) => {
    if (trial.processInstanceId === null || trial.status !== 'scored') return;
    const scores = await scope.scores.list({ processInstanceId: trial.processInstanceId, stepId: run.stepId, limit: 1000 });
    byTrial.set(trial.id, scores.filter((score) =>
      score.source !== 'human' && score.metadata?.evalRunId === run.id));
  }));
  return byTrial;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * The Eval Run report (ADR-0023 D10), computed from the Scores its trials
 * received — so its numbers are the Scores' numbers by construction. Per
 * Evaluator: pass rate with its Wilson 95% interval, pass@k, pass^k and
 * flakiness over cases; a trial the check could not grade counts as an error,
 * not a failure.
 */
export async function buildEvalRunReport(scope: CallerScope, run: EvalRun, trials: readonly EvalTrial[]): Promise<EvalRunReport> {
  const scores = await trialScores(scope, run, trials);
  const scored = trials.filter((trial) => trial.status === 'scored');

  const evaluators = run.evaluators.map((evaluator) => {
    let passes = 0;
    let failures = 0;
    let errors = 0;
    const passedByCase = new Map<string, boolean[]>();
    for (const trial of scored) {
      const score = scores.get(trial.id)?.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
      if (score === undefined) {
        errors += 1;
        continue;
      }
      const passed = score.value >= JUDGE_PASS_VALUE;
      if (passed) passes += 1;
      else failures += 1;
      passedByCase.set(trial.caseId, [...(passedByCase.get(trial.caseId) ?? []), passed]);
    }
    const graded = passes + failures;
    const interval = wilsonInterval(passes, graded);
    const reliability = caseReliability(passedByCase);
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
