import type { AskAboutReviewGapsInput, AskAboutReviewGapsOutput } from '../../contract/evaluation-assistant';
import type { CallerScope } from '../../repositories/index';
import { REVIEW_GAP_SCORE_NAME } from '../scores/classify-review-gap';
import { loadEvaluationSubject, stepOnly, subjectRef } from '../evaluation/_lib/evaluation-subject';
import { askEvaluationAssistant } from './ask-evaluation-assistant';

/**
 * Feeds the production-review feedback loop into the Step's Evaluation
 * Assistant: `review_gap` Scores (see `classify-review-gap.ts`) recorded
 * since `since` where the judge found the step's output missed something.
 * Only when there is at least one does this ask the Assistant to diagnose
 * and propose a fix — same as a person typing `mediforce eval ask`; nothing
 * is applied here or by the Assistant itself (ADR-0023 D15).
 *
 * shortcut: `since` is given by the caller rather than read from a stored
 * per-step cursor — a cron script tracks its own last run. Add a cursor if
 * steps need independent, self-tracking schedules.
 */
export async function askAboutReviewGaps(
  input: AskAboutReviewGapsInput,
  scope: CallerScope,
): Promise<AskAboutReviewGapsOutput> {
  const step = stepOnly(subjectRef(input), 'Asking about review gaps');
  await loadEvaluationSubject(scope, step, 'read', input.definitionVersion);

  const scores = await scope.scores.list({
    namespace: step.namespace, stepId: step.stepId, name: REVIEW_GAP_SCORE_NAME, limit: 200,
  });
  const missed = scores.filter((score) => score.value === 1 && score.createdAt >= input.since);
  if (missed.length === 0) return { missedCount: 0, assistant: null };

  const message = [
    `${missed.length} reviewer correction(s) since ${input.since} named something this step's output missed (review_gap Score):`,
    ...missed.map((score, index) => `${index + 1}. ${score.comment}`),
    'Diagnose why, and propose a fix (a new rule, Evaluator, or a prompt / Evaluation Brief change).',
  ].join('\n');

  const assistant = await askEvaluationAssistant({
    namespace: step.namespace,
    workflowName: step.workflowName,
    stepId: step.stepId,
    definitionVersion: input.definitionVersion,
    messages: [{ role: 'user', content: message }],
    model: input.model,
    unattendedBudgetUsd: input.unattendedBudgetUsd,
  }, scope);

  return { missedCount: missed.length, assistant };
}
