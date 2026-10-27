import { DEFAULT_MODEL, type Score } from '@mediforce/platform-core';
import { classifyReviewGap } from '@mediforce/agent-runtime';
import type { CallerScope } from '../../repositories/index';
import { callOpenRouter } from '../../services/openrouter-client';
import { requireOpenRouterApiKey } from '../../services/openrouter-key';
import { recordScore } from './record-score';

/** The Score a review-gap judgment is recorded as (see `classifyAndRecordReviewGap`). */
export const REVIEW_GAP_SCORE_NAME = 'review_gap';

/**
 * Given a `human_verdict` Score for a correction (danger/warning intent) with
 * a comment, judges whether the comment names something the Agent Run's own
 * output never covered, and records that as a second Score on the same
 * subject (`name: 'review_gap'`). This is the signal that feeds the
 * production-review feedback loop: an accumulation of `missed` Scores for a
 * step is what later prompts a rule or prompt-change proposal.
 *
 * Returns `null`, recording nothing, when the Agent Run has no result to
 * judge against. shortcut: no judge-call cost tracking (unlike Eval Run
 * checks) — add an `onJudgeCall` hook if this needs budget/cost visibility.
 */
export async function classifyAndRecordReviewGap(
  params: { readonly verdictScore: Score; readonly namespace: string },
  scope: CallerScope,
): Promise<Score | null> {
  const { verdictScore, namespace } = params;
  if (verdictScore.comment === null) return null;

  const agentRun = await scope.agentRuns.getById(verdictScore.subject.id);
  const result = agentRun?.envelope?.result;
  if (result === null || result === undefined) return null;

  const apiKey = await requireOpenRouterApiKey(scope, namespace);
  const verdict = await classifyReviewGap(
    {
      complete: async (messages, model) => {
        const response = await callOpenRouter({ model, apiKey, messages, temperature: 0 });
        return { content: response.content, model, usage: response.usage };
      },
    },
    { model: DEFAULT_MODEL, agentOutput: result, comment: verdictScore.comment },
  );

  return recordScore({
    subject: verdictScore.subject,
    name: REVIEW_GAP_SCORE_NAME,
    value: verdict.missed ? 1 : 0,
    label: verdict.missed ? 'missed' : 'covered',
    comment: verdict.rationale,
    source: 'llm_judge',
    createdBy: null,
    metadata: { judgeModel: verdict.model },
    namespace,
    processInstanceId: verdictScore.processInstanceId,
    stepId: verdictScore.stepId,
    evaluatorId: null,
    supersedes: null,
    basis: 'Classifies whether a reviewer\'s correction names something the step\'s own output missed',
  }, scope);
}
