import { llmJudgeMessages, outputAgreementMessages } from '@mediforce/agent-runtime';
import type { EvalCase, EvaluatorCheck } from '@mediforce/platform-core';
import type {
  EvalTrialEvaluator,
  GetEvalTrialInput,
  GetEvalTrialOutput,
  JudgeMessage,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadEvaluationSubject, type EvaluationSubject } from './_lib/evaluation-subject';
import {
  checkOutcome,
  evaluatorError,
  evaluatorsOfCase,
  judgeCallsOf,
  judgeConfidenceOf,
  reviewDecision,
  trialScores,
} from './_lib/trial-scores';

/**
 * What a check's model was sent, rebuilt by the function that sent it: an
 * `llm_judge`'s messages, or an agreement comparison's. Null for a check no
 * model runs, and for a run with no output — no check ran on it.
 */
function judgePromptOf(check: EvaluatorCheck | null, subject: EvaluationSubject | null, evalCase: EvalCase | null): JudgeMessage[] | null {
  const envelope = subject?.agentRun.envelope ?? null;
  const result = envelope?.result;
  if (check === null || subject === null || envelope === null || result === null || result === undefined) return null;
  if (check.kind === 'llm_judge') {
    return llmJudgeMessages({ rubric: check.rubric, stepInput: subject.stepInput, trajectory: subject.trajectory }, envelope);
  }
  if (check.kind === 'expected_output' && evalCase !== null && evalCase.expectedOutput !== null && evalCase.comparison === 'agreement') {
    return outputAgreementMessages({
      instructions: check.instructions ?? null,
      caseInstructions: evalCase.agreementInstructions,
      expected: evalCase.expectedOutput,
      actual: result,
    });
  }
  return null;
}

/**
 * One trial of an Eval Run with everything its Evaluators read and gave: the
 * case, what the step was given, its log and output, and per Evaluator of the
 * case its frozen check, its Score or why it could not grade, a person's
 * review, what its model was sent and what it answered. Readable by whoever
 * may read the step's Evaluation.
 */
export async function getEvalTrial(input: GetEvalTrialInput, scope: CallerScope): Promise<GetEvalTrialOutput> {
  const run = await scope.evaluation.getEvalRun(input.evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${input.evalRunId}' not found`);
  await loadEvaluatedStep(scope, stepRef(run), 'read', run.definitionVersion);
  const trial = (await scope.evaluation.listTrials(run.id)).find((candidate) => candidate.id === input.trialId);
  if (trial === undefined) throw new NotFoundError(`Eval Run '${run.id}' has no trial '${input.trialId}'`);
  const variant = run.variants.find((candidate) => candidate.id === trial.variantId);
  if (variant === undefined) throw new NotFoundError(`Eval Run '${run.id}' has no variant '${trial.variantId}'`);

  const evalCase = await scope.evaluation.getCase(trial.caseId);
  const subject = trial.agentRunId === null ? null : await loadEvaluationSubject(scope, trial.agentRunId);
  const { checks, reviews } = await trialScores(scope, run, trial);
  const scored = trial.status === 'scored';

  const evaluators = await Promise.all(evaluatorsOfCase(run, evalCase).map(async (evaluator): Promise<EvalTrialEvaluator> => {
    const version = (await scope.evaluation.listEvaluatorVersions(evaluator.evaluatorId))
      .find((candidate) => candidate.version === evaluator.version);
    const check = version?.check ?? null;
    const score = checks.find((candidate) => candidate.evaluatorId === evaluator.evaluatorId);
    const review = reviews.get(evaluator.evaluatorId);
    const decision = reviewDecision(review);
    return {
      evaluator,
      rule: version?.rule ?? null,
      check,
      outcome: scored === false ? null : score === undefined ? 'errored' : checkOutcome(score, review),
      score: score === undefined ? null : {
        value: score.value,
        label: score.label,
        comment: score.comment,
        ...judgeConfidenceOf(score),
        agreement: typeof score.metadata?.agreement === 'number' ? score.metadata.agreement : null,
      },
      error: scored && score === undefined ? evaluatorError(trial, evaluator.name) : null,
      review: review === undefined || decision === null
        ? null
        : { decision, reviewedBy: review.createdBy, reviewedAt: review.createdAt, comment: review.comment },
      judgePrompt: judgePromptOf(check, subject, evalCase),
      judgeCalls: score === undefined ? trial.erroredJudgeCalls[evaluator.evaluatorId] ?? null : judgeCallsOf(score),
    };
  }));

  return {
    trial,
    variant,
    evalCase,
    stepInput: subject?.stepInput ?? null,
    result: subject?.agentRun.envelope?.result ?? null,
    reasoningSummary: subject?.agentRun.envelope?.reasoning_summary ?? null,
    trajectory: subject?.trajectory ?? [],
    evaluators,
  };
}
