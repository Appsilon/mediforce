import { JUDGE_PASS_VALUE, type EvalRun, type EvalTrial, type Score } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

/** The Scores an Eval Run's Evaluators gave one of its trials. */
export async function scoresOfTrial(scope: CallerScope, run: EvalRun, trial: EvalTrial): Promise<Score[]> {
  if (trial.processInstanceId === null) return [];
  const scores = await scope.scores.list({ processInstanceId: trial.processInstanceId, stepId: run.stepId, limit: 1000 });
  return scores.filter((score) =>
    score.source !== 'human' && score.metadata?.evalRunId === run.id && score.metadata?.trialId === trial.id);
}

export function isPass(score: Score): boolean {
  return score.value >= JUDGE_PASS_VALUE;
}

/**
 * Whether a trial's Scores pass every counted Evaluator of the run; null when
 * none counts or one of them did not grade it — a missing Score is not a pass.
 */
export function passedEveryCounted(run: EvalRun, scores: readonly Score[]): boolean | null {
  const counted = new Set(run.evaluators.filter((evaluator) => evaluator.counted === true).map((evaluator) => evaluator.evaluatorId));
  if (counted.size === 0) return null;
  const graded = scores.filter((score) => score.evaluatorId !== null && counted.has(score.evaluatorId));
  return new Set(graded.map((score) => score.evaluatorId)).size < counted.size ? null : graded.every(isPass);
}

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}
