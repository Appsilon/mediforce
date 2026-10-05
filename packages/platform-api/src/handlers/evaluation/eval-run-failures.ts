import type { z } from 'zod';
import type { EvalRun, EvalTrial } from '@mediforce/platform-core';
import type {
  EvalTrialFailure,
  GetEvalRunFailuresInputSchema,
  GetEvalRunFailuresOutput,
  TrialEvaluatorFailure,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import { casesOfRun, checkOutcome, evaluatorError, evaluatorsOfCase, trialScores, type CaseSelection } from './_lib/trial-scores';

/** The Evaluators of its case that failed or could not grade a scored trial; a judge verdict left out is neither. */
async function evaluatorFailures(scope: CallerScope, run: EvalRun, trial: EvalTrial, evalCase: CaseSelection): Promise<TrialEvaluatorFailure[]> {
  if (trial.status !== 'scored') return [];
  const { checks, reviews } = await trialScores(scope, run, trial);
  return evaluatorsOfCase(run, evalCase).flatMap((evaluator): TrialEvaluatorFailure[] => {
    const base = {
      evaluatorId: evaluator.evaluatorId,
      name: evaluator.name,
      severity: evaluator.severity,
      kind: evaluator.kind,
      counted: evaluator.counted,
    };
    const score = checks.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
    if (score === undefined) return [{ ...base, outcome: 'errored', comment: null, error: evaluatorError(trial, evaluator.name) }];
    return checkOutcome(score, reviews.get(evaluator.evaluatorId)) === 'fail'
      ? [{ ...base, outcome: 'failed', comment: score.comment, error: null }]
      : [];
  });
}

/**
 * An Eval Run's failing trials (ADR-0023 D14) — the material
 * the Evaluation Assistant diagnoses and fixes from: a trial that failed
 * before producing an Agent Run, one where a counted Evaluator failed, or one
 * a check could not grade. Each carries its case, and the Evaluators that
 * failed or errored on it, counted or not.
 */
export async function getEvalRunFailures(
  input: z.output<typeof GetEvalRunFailuresInputSchema>,
  scope: CallerScope,
): Promise<GetEvalRunFailuresOutput> {
  const run = await scope.evaluation.getEvalRun(input.evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${input.evalRunId}' not found`);

  const trials = await scope.evaluation.listTrials(run.id);
  const judged = trials.filter((trial) => trial.status === 'failed' || trial.status === 'scored');
  const cases = await casesOfRun(scope, run);
  const withEvaluators = await Promise.all(
    judged.map(async (trial) => ({ trial, evaluators: await evaluatorFailures(scope, run, trial, cases.get(trial.caseId) ?? null) })),
  );
  const failing = withEvaluators.filter(({ trial, evaluators }) => trial.status === 'failed'
    || trial.agentRunId === null
    || evaluators.some((evaluator) => evaluator.outcome === 'errored' || evaluator.counted === true));

  const shown = failing.slice(0, input.limit);
  const failures: EvalTrialFailure[] = shown.map(({ trial, evaluators }) => {
    const evalCase = cases.get(trial.caseId) ?? null;
    return {
      trialId: trial.id,
      trialIndex: trial.trialIndex,
      status: trial.status,
      caseId: trial.caseId,
      caseName: evalCase?.name ?? null,
      split: evalCase?.split ?? null,
      expectation: evalCase?.expectation ?? null,
      expectedOutput: evalCase?.expectedOutput ?? null,
      agentRunId: trial.agentRunId,
      error: trial.error,
      evaluators,
    };
  });
  return { evalRunId: run.id, total: failing.length, failures };
}
