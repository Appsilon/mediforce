import type { EvalRun, EvalTrial, JudgeReviewDecision, Score } from '@mediforce/platform-core';
import type { ReviewJudgeVerdictInput, ReviewJudgeVerdictOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { resolveTargetUid } from '../_helpers';
import { recordScore } from '../scores/record-score';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { isModelVerdict, trialScores } from './_lib/trial-scores';

/** The name of the human Score a person's review of a judge's verdict is recorded as. */
export const JUDGE_REVIEW_SCORE_NAME = 'judge_review';

export interface JudgeReview {
  readonly run: EvalRun;
  readonly trial: EvalTrial;
  /** The judge's verdict under review. */
  readonly judgeScore: Score;
  readonly decision: JudgeReviewDecision;
  readonly comment: string | null;
  readonly reviewedBy: string;
}

/**
 * Records a person's review of one judge verdict on one trial: `accepted`
 * counts it whatever the judge's confidence, `denied` leaves it out of the
 * Acceptance Criteria whatever its confidence — never reversed. A later review
 * supersedes the earlier one, so the history stays.
 */
export async function recordJudgeReview(scope: CallerScope, review: JudgeReview): Promise<Score> {
  const { run, trial, judgeScore, decision } = review;
  const evaluatorId = judgeScore.evaluatorId!;
  const previous = (await trialScores(scope, run, trial)).reviews.get(evaluatorId);
  return recordScore({
    subject: judgeScore.subject,
    name: JUDGE_REVIEW_SCORE_NAME,
    value: decision === 'accepted' ? 1 : 0,
    label: decision,
    comment: review.comment,
    source: 'human',
    createdBy: review.reviewedBy,
    metadata: { evalRunId: run.id, trialId: trial.id, caseId: trial.caseId, judgeScoreId: judgeScore.id, judgeReview: decision },
    namespace: run.namespace,
    processInstanceId: judgeScore.processInstanceId,
    stepId: run.stepId,
    evaluatorId,
    supersedes: previous?.id ?? null,
    basis: `A person ${decision} judge '${judgeScore.name}''s verdict on Eval Run '${run.id}' (ADR-0023)`,
  }, scope);
}


/**
 * A person accepts or denies one model's verdict — a judge's, or an
 * expected-output agreement score — on one trial of an Eval Run, having read
 * its rationale. `accepted` counts it toward the Acceptance
 * Criteria whatever the judge's confidence; `denied` leaves it out — never
 * reversed. There is deliberately no assistant tool for this (D15).
 */
export async function reviewJudgeVerdict(
  input: ReviewJudgeVerdictInput,
  scope: CallerScope,
): Promise<ReviewJudgeVerdictOutput> {
  const reviewedBy = resolveTargetUid(input, scope, 'review', 'review a judge verdict');
  const run = await scope.evaluation.getEvalRun(input.evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${input.evalRunId}' not found`);
  await loadEvaluatedStep(scope, stepRef(run), 'edit', run.definitionVersion);
  const trial = (await scope.evaluation.listTrials(run.id)).find((candidate) => candidate.id === input.trialId);
  if (trial === undefined) throw new NotFoundError(`Eval Run '${run.id}' has no trial '${input.trialId}'`);
  const judge = run.evaluators.find((evaluator) => evaluator.evaluatorId === input.evaluatorId);
  if (judge === undefined) throw new NotFoundError(`Eval Run '${run.id}' did not run Evaluator '${input.evaluatorId}'`);
  const judgeScore = (await trialScores(scope, run, trial)).checks.find((score) => score.evaluatorId === judge.evaluatorId);
  if (judgeScore === undefined) throw new NotFoundError(`Evaluator '${judge.name}' gave no verdict on trial '${trial.id}'`);
  if (isModelVerdict(judgeScore) === false) {
    throw new ValidationError(`Evaluator '${judge.name}''s verdict on trial '${trial.id}' is not a model's verdict; only a judge's verdict or an agreement score is reviewed`);
  }

  const score = await recordJudgeReview(scope, {
    run,
    trial,
    judgeScore,
    decision: input.decision,
    comment: input.comment ?? null,
    reviewedBy,
  });
  return { score };
}
