import type { z } from 'zod';
import { CHAMPION_VARIANT_ID, type EvalRun, type EvalTrial } from '@mediforce/platform-core';
import type {
  EvalTrialFailure,
  GetEvalRunFailuresInputSchema,
  GetEvalRunFailuresOutput,
  TrialEvaluatorFailure,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import { isPass, scoresOfTrial } from './_lib/trial-scores';

/** The part of a trial's error that names one Evaluator — how the driver records a check that could not run. */
function evaluatorError(trial: EvalTrial, name: string): string {
  const prefix = `${name}: `;
  const found = (trial.error ?? '').split('; ').find((part) => part.startsWith(prefix));
  return found === undefined ? 'no Score recorded' : found.slice(prefix.length);
}

/** The Evaluators that failed or could not grade a scored trial. */
async function evaluatorFailures(scope: CallerScope, run: EvalRun, trial: EvalTrial): Promise<TrialEvaluatorFailure[]> {
  if (trial.status !== 'scored') return [];
  const scores = await scoresOfTrial(scope, run, trial);
  return run.evaluators.flatMap((evaluator): TrialEvaluatorFailure[] => {
    const base = {
      evaluatorId: evaluator.evaluatorId,
      name: evaluator.name,
      severity: evaluator.severity,
      kind: evaluator.kind,
      counted: evaluator.counted,
    };
    const score = scores.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
    if (score === undefined) return [{ ...base, outcome: 'errored', comment: null, error: evaluatorError(trial, evaluator.name) }];
    return isPass(score) ? [] : [{ ...base, outcome: 'failed', comment: score.comment, error: null }];
  });
}

/**
 * One variant's failing trials in an Eval Run (ADR-0023 D14) — the material
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
  const variantId = input.variantId ?? CHAMPION_VARIANT_ID;
  const variant = run.variants.find((candidate) => candidate.id === variantId);
  if (variant === undefined) {
    throw new NotFoundError(`Eval Run '${run.id}' has no variant '${variantId}'; its variants are ${run.variants.map((candidate) => candidate.id).join(', ')}`);
  }

  const trials = (await scope.evaluation.listTrials(run.id)).filter((trial) => trial.variantId === variantId);
  const judged = trials.filter((trial) => trial.status === 'failed' || trial.status === 'scored');
  const withEvaluators = await Promise.all(
    judged.map(async (trial) => ({ trial, evaluators: await evaluatorFailures(scope, run, trial) })),
  );
  const failing = withEvaluators.filter(({ trial, evaluators }) => trial.status === 'failed'
    || trial.agentRunId === null
    || evaluators.some((evaluator) => evaluator.outcome === 'errored' || evaluator.counted === true));

  const shown = failing.slice(0, input.limit);
  const cases = new Map(await Promise.all([...new Set(shown.map(({ trial }) => trial.caseId))]
    .map(async (caseId) => [caseId, await scope.evaluation.getCase(caseId)] as const)));
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
      caseNotes: evalCase?.notes ?? null,
      agentRunId: trial.agentRunId,
      error: trial.error,
      evaluators,
    };
  });
  return { evalRunId: run.id, variantId, variantLabel: variant.label, total: failing.length, failures };
}
