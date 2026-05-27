import { evaluateExpression } from '@mediforce/workflow-engine';
import type { ResumeWaitInput, ResumeWaitOutput } from '../../contract/processes.js';
import type { CallerScope } from '../../repositories/index.js';
import { PreconditionFailedError } from '../../errors.js';
import { loadOr404 } from '../_helpers.js';

interface WaitMetadata {
  stepId: string;
  resumeAt: string;
  pausedAt: string;
  condition?: string;
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

  let conditionMet = false;
  if (waitMeta.condition) {
    try {
      conditionMet = !!evaluateExpression(waitMeta.condition, {
        output: run.variables as Record<string, unknown>,
        variables: run.variables as Record<string, unknown>,
        verdict: undefined,
      });
    } catch {
      // Condition evaluation failure — don't resume, let next poll retry
    }
  }

  if (now < resumeAt && !conditionMet) {
    return { resumed: false, resumeAt: waitMeta.resumeAt };
  }

  const waitedSeconds = Math.round(
    (now.getTime() - new Date(waitMeta.pausedAt).getTime()) / 1000,
  );
  const resumeReason = conditionMet ? 'condition_met' : 'duration_elapsed';
  const waitOutput = { resumeReason, waitedSeconds, resolvedAt: now.toISOString() };

  const { __wait: _, ...cleanVars } = run.variables as Record<string, unknown>;
  await scope.runs.update(input.runId, {
    status: 'running',
    pauseReason: null,
    variables: { ...cleanVars, [waitMeta.stepId]: waitOutput },
    updatedAt: now.toISOString(),
  });

  await scope.system.engine.advanceStep(
    input.runId,
    waitOutput,
    { id: 'timer-resume', role: 'system' },
  );

  await scope.system.audit.append({
    actorId: 'timer-resume',
    actorType: 'system',
    actorRole: 'scheduler',
    action: 'instance.wait.resumed',
    description: `Wait action resumed for '${input.runId}' (reason: ${resumeReason}, waited ${waitedSeconds}s)`,
    timestamp: now.toISOString(),
    inputSnapshot: { stepId: waitMeta.stepId, resumeAt: waitMeta.resumeAt, condition: waitMeta.condition },
    outputSnapshot: waitOutput,
    basis: `Timer expired or condition met: ${resumeReason}`,
    entityType: 'processInstance',
    entityId: input.runId,
    processInstanceId: input.runId,
    processDefinitionVersion: run.definitionVersion,
  });

  await scope.system.runKicker.kick(input.runId, { triggeredBy: 'timer-resume' });

  return { resumed: true, resumeReason };
}
