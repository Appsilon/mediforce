import {
  defaultVerdictIntent,
  type CompleteHumanTaskPayload,
  type HumanTask,
  type Score,
  type TaskVerdict,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { recordScore } from './record-score';

const VALUE_BY_INTENT: Record<TaskVerdict['intent'], number> = {
  success: 1,
  danger: 0,
  warning: 0.5,
  neutral: 0.5,
};

/**
 * The Agent Run a CM3 review task judges. New review tasks carry its id; one
 * created before they did falls back to the step's most recent Agent Run.
 */
async function reviewedAgentRunId(task: HumanTask, scope: CallerScope): Promise<string | null> {
  const completionData = task.completionData as { agentOutput?: { agentRunId?: unknown } } | null;
  const carried = completionData?.agentOutput?.agentRunId;
  if (typeof carried === 'string') return carried;
  const [latest] = (await scope.agentRuns.getByInstanceId(task.processInstanceId))
    .filter((run) => run.stepId === task.stepId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  return latest?.id ?? null;
}

/**
 * Turn a completed CM3 review into a `human_verdict` Score on the Agent Run it
 * reviewed (ADR-0023 D13). The verdict key is the label; its intent is mapped
 * to 1 / 0.5 / 0 so verdicts from different vocabularies aggregate. Returns
 * `null` for any task that is not an agent review with a verdict.
 */
export async function recordHumanVerdictScore(
  params: {
    readonly task: HumanTask;
    readonly payload: CompleteHumanTaskPayload;
    readonly actorId: string;
    readonly namespace: string;
  },
  scope: CallerScope,
): Promise<Score | null> {
  const { task, payload, actorId, namespace } = params;
  if (task.creationReason !== 'agent_review_l3') return null;
  if (payload.kind !== 'verdict' && payload.kind !== 'verdict-with-params') return null;

  const agentRunId = await reviewedAgentRunId(task, scope);
  if (agentRunId === null) return null;

  const intent = task.verdicts?.find((descriptor) => descriptor.key === payload.verdict)?.intent
    ?? defaultVerdictIntent(payload.verdict);
  const comment = payload.comment?.trim() ?? '';

  return recordScore({
    subject: { type: 'agent_run', id: agentRunId },
    name: 'human_verdict',
    value: VALUE_BY_INTENT[intent],
    label: payload.verdict,
    comment: comment.length > 0 ? comment : null,
    source: 'human',
    createdBy: actorId,
    metadata: { verdictKey: payload.verdict, intent, taskId: task.id },
    namespace,
    processInstanceId: task.processInstanceId,
    stepId: task.stepId,
    evaluatorId: null,
    supersedes: null,
    basis: 'Control Mode 3 review verdict',
  }, scope);
}
