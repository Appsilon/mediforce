import {
  JUDGE_PASS_VALUE,
  type EvalRun,
  type EvalTrial,
  type EvaluatorCheck,
  type JudgeReviewDecision,
  type Score,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';

/** What an Eval Run recorded on one trial: its checks' Scores, and people's reviews of its judges' verdicts. */
export interface TrialScores {
  readonly checks: readonly Score[];
  /** The newest review of each judge's verdict, by Evaluator id. */
  readonly reviews: ReadonlyMap<string, Score>;
}

export function reviewDecision(review: Score | undefined): JudgeReviewDecision | null {
  const decision = review?.metadata?.judgeReview;
  return decision === 'accepted' || decision === 'denied' ? decision : null;
}

function newestReviews(reviews: readonly Score[]): Map<string, Score> {
  const superseded = new Set(reviews.map((review) => review.supersedes).filter((id) => id !== null));
  return new Map(reviews
    .filter((review) => review.evaluatorId !== null && superseded.has(review.id) === false)
    .map((review) => [review.evaluatorId!, review]));
}

export async function trialScores(scope: CallerScope, run: EvalRun, trial: EvalTrial): Promise<TrialScores> {
  if (trial.processInstanceId === null) return { checks: [], reviews: new Map() };
  const scores = (await scope.scores.list({ processInstanceId: trial.processInstanceId, stepId: run.stepId, limit: 1000 }))
    .filter((score) => score.metadata?.evalRunId === run.id && score.metadata?.trialId === trial.id);
  return {
    checks: scores.filter((score) => score.source !== 'human'),
    reviews: newestReviews(scores.filter((score) => score.source === 'human' && reviewDecision(score) !== null)),
  };
}

/** The Scores an Eval Run's Evaluators gave one of its trials. */
export async function scoresOfTrial(scope: CallerScope, run: EvalRun, trial: EvalTrial): Promise<readonly Score[]> {
  return (await trialScores(scope, run, trial)).checks;
}

export function isPass(score: Score): boolean {
  return score.value >= JUDGE_PASS_VALUE;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** What a judge's Score keeps of its confidence: the confidence, and the floor its Evaluator version set. */
export function judgeConfidenceMetadata(check: EvaluatorCheck, confidence: number | null): Record<string, number> {
  return check.kind === 'llm_judge' && confidence !== null
    ? { judgeConfidence: confidence, judgeMinConfidence: check.minConfidence }
    : {};
}

/** The judge's confidence in its verdict and the floor it was held to; null on Scores from before judges reported one. */
export function judgeConfidenceOf(score: Score): { confidence: number | null; minConfidence: number | null } {
  return { confidence: numberOrNull(score.metadata?.judgeConfidence), minConfidence: numberOrNull(score.metadata?.judgeMinConfidence) };
}

export type CheckOutcome = 'pass' | 'fail' | 'excluded';

/**
 * Whether a check's Score counts, and how. A judge verdict a person denied is
 * left out, however confident; one a person accepted counts, however unsure;
 * an unreviewed one is left out when the judge was less confident than its
 * Evaluator's `minConfidence`.
 */
export function checkOutcome(score: Score, review: Score | undefined): CheckOutcome {
  const decision = reviewDecision(review);
  if (decision === 'denied') return 'excluded';
  const { confidence, minConfidence } = judgeConfidenceOf(score);
  if (decision === null && confidence !== null && minConfidence !== null && confidence < minConfidence) return 'excluded';
  return isPass(score) ? 'pass' : 'fail';
}

/** A trial's check Scores that count — a left-out judge verdict is as if the judge had not graded it. */
export function countedScores(scores: TrialScores): Score[] {
  return scores.checks.filter((score) => checkOutcome(score, scores.reviews.get(score.evaluatorId ?? '')) !== 'excluded');
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
