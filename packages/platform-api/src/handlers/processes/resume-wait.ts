import type { InstanceStatus, ProcessInstance } from '@mediforce/platform-core';
import { evaluateExpression } from '@mediforce/workflow-engine';
import { toCollectedChild, type CollectedChild, type WaitActionOutput, type WaitSentinel } from '@mediforce/core-actions';
import type { ResumeWaitInput, ResumeWaitOutput } from '../../contract/processes';
import type { CallerScope } from '../../repositories/index';
import { PreconditionFailedError } from '../../errors';
import { actorFromCaller, loadOr404 } from '../_helpers';

type WaitMetadata = WaitSentinel['__wait'];
type ResumeReason = WaitActionOutput['resumeReason'] | 'child_finished';

const TERMINAL_STATUSES: readonly InstanceStatus[] = ['completed', 'failed'];

type ChildrenSummary = {
  totalCount: number;
  completedCount: number;
  failedCount: number;
  allFinished: boolean;
};

const REFERENCES_CHILDREN = /\bchildren\b/;

// The `children.*` root of a wait condition — the join half of spawn + wait.
// Read from the children at sweep time, so a child finishing
// never writes into its parent. A child that failed has still finished: the
// join waits for every child to stop, not for every child to succeed.
async function summarizeChildren(runId: string, scope: CallerScope): Promise<ChildrenSummary> {
  const statuses = (await scope.runs.getChildren(runId)).map((child) => child.status);
  const finishedCount = statuses.filter((status) => TERMINAL_STATUSES.includes(status)).length;
  return {
    totalCount: statuses.length,
    completedCount: statuses.filter((status) => status === 'completed').length,
    failedCount: statuses.filter((status) => status === 'failed').length,
    allFinished: finishedCount === statuses.length,
  };
}

export async function resumeWait(
  input: ResumeWaitInput,
  scope: CallerScope,
): Promise<ResumeWaitOutput> {
  const run = await loadOr404(scope.runs.getById(input.runId), 'Run not found');

  if (run.status !== 'paused' || run.pauseReason !== 'waiting_for_timer') {
    throw new PreconditionFailedError(
      `Run is not in waiting_for_timer state (status: ${run.status}, pauseReason: ${run.pauseReason})`,
      { runId: input.runId, currentStatus: run.status, pauseReason: run.pauseReason },
    );
  }

  const waitMeta = (run.variables as Record<string, unknown>).__wait as WaitMetadata | undefined;
  if (!waitMeta?.resumeAt) {
    throw new PreconditionFailedError(
      'Run is paused for timer but missing __wait metadata',
      { runId: input.runId },
    );
  }

  const now = new Date();
  const resumeAt = new Date(waitMeta.resumeAt);

  if (waitMeta.child !== undefined) {
    const child = await readChild(waitMeta.child, scope);
    const childEnded = TERMINAL_STATUSES.includes(child.status);
    if (now < resumeAt && childEnded === false) {
      return { resumed: false, resumeAt: waitMeta.resumeAt };
    }
    return resolveWait(run, waitMeta, scope, now, childEnded ? 'child_finished' : 'deadline_reached', child);
  }

  let conditionMet = false;
  if (waitMeta.condition) {
    try {
      conditionMet = !!evaluateExpression(waitMeta.condition, {
        output: run.variables as Record<string, unknown>,
        variables: run.variables as Record<string, unknown>,
        verdict: undefined,
        ...(REFERENCES_CHILDREN.test(waitMeta.condition)
          ? { children: await summarizeChildren(input.runId, scope) }
          : {}),
      });
    } catch (err) {
      // Condition evaluation failure — don't resume, let next poll retry.
      // Logged so a mistyped condition is visible instead of silently waiting out the deadline.
      console.error(`[resume-wait] Condition evaluation failed for '${input.runId}':`, err);
    }
  }

  if (now < resumeAt && !conditionMet) {
    return { resumed: false, resumeAt: waitMeta.resumeAt };
  }

  const resumeReason: WaitActionOutput['resumeReason'] = conditionMet
    ? 'condition_met'
    : waitMeta.mode === 'deadline' ? 'deadline_reached' : 'duration_elapsed';
  const waitOutput: WaitActionOutput = { resumeReason, waitedSeconds: waitedSecondsSince(waitMeta, now), resolvedAt: now.toISOString() };
  return resolveWait(run, waitMeta, scope, now, resumeReason, waitOutput);
}

function waitedSecondsSince(waitMeta: WaitMetadata, now: Date): number {
  return Math.round((now.getTime() - new Date(waitMeta.pausedAt).getTime()) / 1000);
}

// The run-workflow child, read fresh. A child that is gone can never end, so it
// resolves the step as failed rather than parking the parent until the timeout.
async function readChild(
  child: NonNullable<WaitMetadata['child']>,
  scope: CallerScope,
): Promise<CollectedChild> {
  const childRun = await scope.runs.getById(child.instanceId);
  if (childRun === null) {
    return {
      instanceId: child.instanceId,
      definitionName: child.definitionName,
      status: 'failed',
      error: `Child run '${child.instanceId}' no longer exists`,
      output: null,
    };
  }
  return toCollectedChild(childRun, child.step);
}

async function resolveWait(
  run: ProcessInstance,
  waitMeta: WaitMetadata,
  scope: CallerScope,
  now: Date,
  resumeReason: ResumeReason,
  waitOutput: WaitActionOutput | CollectedChild,
): Promise<ResumeWaitOutput> {
  const waitedSeconds = waitedSecondsSince(waitMeta, now);
  const { __wait: _, ...cleanVars } = run.variables as Record<string, unknown>;
  // Several callers can reach this point for one run at once (each finishing
  // child, the heartbeat, a manual call); the guarded write lets exactly one
  // of them resume it.
  const won = await scope.runs.updateIfPaused(run.id, 'waiting_for_timer', {
    status: 'running',
    pauseReason: null,
    variables: { ...cleanVars, [waitMeta.stepId]: waitOutput },
    updatedAt: now.toISOString(),
  });
  if (!won) {
    return { resumed: false, resumeAt: waitMeta.resumeAt };
  }

  const actor = actorFromCaller(scope, 'scheduler');

  // Audit + kick are best-effort — state update already committed above.
  // Don't let a secondary failure (audit write, kick POST) mask a successful resume.
  try {
    await scope.system.audit.append({
      ...actor,
      action: 'instance.wait.resumed',
      description: `Wait action resumed for '${run.id}' (reason: ${resumeReason}, waited ${waitedSeconds}s)`,
      timestamp: now.toISOString(),
      inputSnapshot: { stepId: waitMeta.stepId, resumeAt: waitMeta.resumeAt, condition: waitMeta.condition, child: waitMeta.child },
      outputSnapshot: { ...waitOutput },
      basis: `Timer expired, condition met or child ended: ${resumeReason}`,
      entityType: 'processInstance',
      entityId: run.id,
      processInstanceId: run.id,
      processDefinitionVersion: run.definitionVersion,
    });
  } catch (err) {
    console.error(`[resume-wait] Audit write failed for '${run.id}':`, err);
  }

  await scope.system.runKicker.kick(run.id, { triggeredBy: actor.actorId });

  return { resumed: true, resumeReason };
}
