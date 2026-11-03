import { z } from 'zod';
import {
  defaultVerdictIntent,
  type AgentRun,
  type CompleteHumanTaskPayload,
  type HumanTask,
  type Score,
  type TaskVerdict,
} from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { recordScore } from './record-score';

/** The Score a reviewer's verdict on an Agent Run is recorded as. */
export const HUMAN_VERDICT_SCORE_NAME = 'human_verdict';

const VALUE_BY_INTENT: Record<TaskVerdict['intent'], number> = {
  success: 1,
  danger: 0,
  warning: 0.5,
  neutral: 0.5,
};

const ReviewTaskDataSchema = z.object({
  agentOutput: z.object({ agentRunId: z.string().min(1).nullable().optional() }),
});

/**
 * The Agent Run a CM3 review task judges. Review tasks carry its id — `null`
 * when the run was never recorded. A task created before they carried it at
 * all falls back to the step's latest Agent Run started by the time the review
 * was opened, so a re-run after a "revise" verdict is never picked.
 */
async function reviewedAgentRunId(task: HumanTask, scope: CallerScope): Promise<string | null> {
  const reviewData = ReviewTaskDataSchema.safeParse(task.completionData);
  if (reviewData.success === false) return null;
  const carried = reviewData.data.agentOutput.agentRunId;
  if (carried !== undefined) return carried;
  const reviewOpenedAt = Date.parse(task.createdAt);
  const [latest] = (await scope.agentRuns.getByInstanceId(task.processInstanceId))
    .filter((run) => run.stepId === task.stepId && Date.parse(run.startedAt) <= reviewOpenedAt)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  return latest?.id ?? null;
}

/**
 * The Agent Run a human step's verdict sends back: the latest run, by the time
 * the task opened, of the earlier agent step the verdict routes to. `null` for
 * a verdict that moves the workflow on.
 */
async function sentBackAgentRun(task: HumanTask, verdict: string, scope: CallerScope): Promise<AgentRun | null> {
  const instance = await scope.runs.getById(task.processInstanceId);
  if (instance === null) return null;
  const definition = await scope.workflowDefinitions.get(instance.namespace ?? '', instance.definitionName, Number(instance.definitionVersion));
  const reviewIndex = definition?.steps.findIndex((step) => step.id === task.stepId) ?? -1;
  const targetId = definition?.steps[reviewIndex]?.verdicts?.[verdict]?.target;
  const targetIndex = definition?.steps.findIndex((step) => step.id === targetId) ?? -1;
  if (targetIndex === -1 || targetIndex > reviewIndex || definition?.steps[targetIndex]?.executor !== 'agent') return null;
  const reviewOpenedAt = Date.parse(task.createdAt);
  const [latest] = (await scope.agentRuns.getByInstanceId(task.processInstanceId))
    .filter((run) => run.stepId === targetId && Date.parse(run.startedAt) <= reviewOpenedAt)
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  return latest ?? null;
}

/**
 * Turn a completed review into a `human_verdict` Score on the Agent Run it
 * reviewed (ADR-0023 D13): a CM3 review of its own step, or a human step whose
 * verdict sends an earlier agent step back to run again. The verdict key is the
 * label; its intent is mapped to 1 / 0.5 / 0 so verdicts from different
 * vocabularies aggregate. Returns `null` for any other task, or when the
 * reviewed Agent Run cannot be identified.
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
  if (payload.kind !== 'verdict' && payload.kind !== 'verdict-with-params') return null;

  const isCm3Review = task.creationReason === 'agent_review_l3';
  const sentBackRun = isCm3Review ? null : await sentBackAgentRun(task, payload.verdict, scope);
  const agentRunId = isCm3Review ? await reviewedAgentRunId(task, scope) : sentBackRun?.id ?? null;
  if (agentRunId === null) return null;

  const intent = task.verdicts?.find((descriptor) => descriptor.key === payload.verdict)?.intent
    ?? defaultVerdictIntent(payload.verdict);
  const comment = payload.comment?.trim() ?? '';

  return recordScore({
    subject: { type: 'agent_run', id: agentRunId },
    name: HUMAN_VERDICT_SCORE_NAME,
    value: VALUE_BY_INTENT[intent],
    label: payload.verdict,
    comment: comment.length > 0 ? comment : null,
    source: 'human',
    createdBy: actorId,
    metadata: {
      verdictKey: payload.verdict,
      intent,
      taskId: task.id,
      ...(sentBackRun === null ? {} : { sentBack: true }),
      ...(payload.kind === 'verdict-with-params' && Object.keys(payload.paramValues).length > 0 ? { paramValues: payload.paramValues } : {}),
    },
    namespace,
    processInstanceId: task.processInstanceId,
    stepId: sentBackRun?.stepId ?? task.stepId,
    evaluatorId: null,
    supersedes: null,
    basis: isCm3Review ? 'Control Mode 3 review verdict' : `Human step '${task.stepId}' sent the run back`,
  }, scope);
}
