import type { EvalRun, EvalTrial, Score } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

/** The Scores an Eval Run's Evaluators gave one of its trials. */
export async function scoresOfTrial(scope: CallerScope, run: EvalRun, trial: EvalTrial): Promise<Score[]> {
  if (trial.processInstanceId === null) return [];
  const scores = await scope.scores.list({ processInstanceId: trial.processInstanceId, stepId: run.stepId, limit: 1000 });
  return scores.filter((score) =>
    score.source !== 'human' && score.metadata?.evalRunId === run.id && score.metadata?.trialId === trial.id);
}
