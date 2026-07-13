import type { CronTriggerState, Trigger, WorkflowDefinition } from '@mediforce/platform-core';
import { validateCronSchedule, isDue } from '@mediforce/workflow-engine';
import type {
  HeartbeatInput,
  HeartbeatOutput,
  SkippedEntry,
  TriggeredEntry,
} from '../../contract/cron';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError, PreconditionFailedError } from '../../errors';
import { resumeWait } from '../processes/resume-wait';

type Evaluation = { fire: true } | { fire: false; reason: string };

function evaluateTrigger(
  trigger: Trigger,
  state: CronTriggerState | null,
  definitionCreatedAt: string | undefined,
  now: Date,
): Evaluation {
  const schedule = trigger.schedule;
  if (!schedule) return { fire: false, reason: 'No schedule defined' };

  const validation = validateCronSchedule(schedule);
  if (!validation.valid) return { fire: false, reason: `Invalid schedule: ${validation.error}` };

  const lastTriggeredAt = state
    ? new Date(state.lastTriggeredAt)
    : definitionCreatedAt
      ? new Date(definitionCreatedAt)
      : undefined;
  if (!isDue(schedule, now, lastTriggeredAt)) return { fire: false, reason: 'Not due' };

  return { fire: true };
}

// System-actor only — reads across every workspace's definitions; gating
// is by apiKey at the call site, not per row. Skipped triggers surface in
// the response body + console.log but are NOT audited (no state change).
export async function heartbeat(
  _input: HeartbeatInput,
  scope: CallerScope,
): Promise<HeartbeatOutput> {
  if (scope.caller.kind !== 'apiKey') {
    throw new ForbiddenError(
      'cron heartbeat requires system-actor credentials (X-Api-Key)',
    );
  }

  const now = new Date();
  const triggered: TriggeredEntry[] = [];
  const skipped: SkippedEntry[] = [];

  const definitionGroups = await scope.workflowDefinitions.listGroups(false);
  const cronDefinitions = definitionGroups
    .map((group) => group.versions.find((v) => v.version === group.latestVersion))
    .filter((def): def is WorkflowDefinition => def !== undefined)
    .filter((def) => !def.deleted)
    .filter((def) => def.triggers.some((t: Trigger) => t.type === 'cron'));

  for (const def of cronDefinitions) {
    const cronTriggers = def.triggers.filter((t: Trigger) => t.type === 'cron');

    for (const trigger of cronTriggers) {
      const state = await scope.cron.get(def.name, trigger.name);
      const evaluation = evaluateTrigger(trigger, state, def.createdAt, now);
      const entryHead = {
        definitionName: def.name,
        definitionVersion: def.version,
        triggerName: trigger.name,
      };

      if (!evaluation.fire) {
        skipped.push({ ...entryHead, reason: evaluation.reason });
        console.log(`[cron-heartbeat] skip '${def.name}/${trigger.name}': ${evaluation.reason}`);
        continue;
      }

      const result = await scope.system.cronTrigger.fireWorkflow({
        namespace: def.namespace,
        definitionName: def.name,
        definitionVersion: def.version,
        triggerName: trigger.name,
        triggeredBy: 'cron-heartbeat',
        payload: { schedule: trigger.schedule, firedAt: now.toISOString() },
      });

      // Persist state AFTER successful fire (at-least-once semantics).
      await scope.cron.set({
        definitionName: def.name,
        triggerName: trigger.name,
        lastTriggeredAt: now.toISOString(),
      });

      await scope.system.audit.append({
        actorId: 'cron-heartbeat',
        actorType: 'system',
        actorRole: 'scheduler',
        action: 'cron.trigger.fired',
        description: `Cron trigger '${trigger.name}' fired for '${def.name}' v${def.version}`,
        timestamp: now.toISOString(),
        inputSnapshot: { ...entryHead, schedule: trigger.schedule },
        outputSnapshot: { instanceId: result.instanceId },
        basis: 'Cron trigger schedule due',
        entityType: 'processInstance',
        entityId: result.instanceId,
        processInstanceId: result.instanceId,
        processDefinitionVersion: String(def.version),
      });

      await scope.system.runKicker.kick(result.instanceId, { triggeredBy: 'cron-heartbeat' });
      triggered.push({ ...entryHead, instanceId: result.instanceId });
    }
  }

  // Sweep: resume timer-paused instances whose deadline has passed
  const pausedInstances = await scope.runs.getByStatus('paused');
  const waitingInstances = pausedInstances.filter(
    (inst) => inst.pauseReason === 'waiting_for_timer',
  );

  for (const inst of waitingInstances) {
    try {
      await resumeWait({ runId: inst.id }, scope);
    } catch (err) {
      if (!(err instanceof PreconditionFailedError)) {
        console.error(`[cron-heartbeat] Unexpected error resuming '${inst.id}':`, err);
      }
    }
  }

  // Sweep: escalate runs that are paused with no recorded reason.
  // These are stranded — the heartbeat can never resume them and no UI
  // action clears them. Fail them so the user sees a retryable error
  // rather than a run stuck at "in progress" indefinitely.
  const orphanedInstances = pausedInstances.filter(
    (inst) => inst.pauseReason === null || inst.pauseReason === undefined,
  );

  for (const inst of orphanedInstances) {
    try {
      await scope.runs.update(inst.id, {
        status: 'failed',
        error:
          `Run paused without a recorded reason — the scheduler could not resume it automatically. ` +
          `Resume this run to restart from the current step.`,
        updatedAt: new Date().toISOString(),
      });
      await scope.system.audit.append({
        actorId: 'cron-heartbeat',
        actorType: 'system',
        actorRole: 'scheduler',
        action: 'instance.orphan_escalated',
        description: `Orphaned paused run '${inst.id}' escalated to failed (no pauseReason recorded)`,
        timestamp: new Date().toISOString(),
        inputSnapshot: { runId: inst.id, currentStepId: inst.currentStepId },
        outputSnapshot: { status: 'failed' },
        basis: 'Heartbeat orphan sweep: paused run with null pauseReason',
        entityType: 'processInstance',
        entityId: inst.id,
        processInstanceId: inst.id,
        processDefinitionVersion: inst.definitionVersion,
      });
      console.log(`[cron-heartbeat] Escalated orphaned paused run '${inst.id}' (step: ${inst.currentStepId}) to failed`);
    } catch (err) {
      console.error(`[cron-heartbeat] Failed to escalate orphaned run '${inst.id}':`, err);
    }
  }

  // Sweep: re-kick runs stranded in `running` past the step-timeout bound.
  // A `running` run whose driver request died mid-step (deploy, crash, OOM,
  // gateway timeout) is invisible to every other sweep — only `paused` is
  // swept — and would sit at its current step indefinitely. Re-kick, not
  // fail: `/run` returns 409 while a live driver still holds the per-process
  // lock, so only genuinely driverless runs advance. The bound sits well
  // above the 30-minute default step timeout, so a legitimately long step is
  // never mistaken for a stranded one.
  const STRANDED_RUNNING_BOUND_MS = 45 * 60 * 1000;
  const runningInstances = await scope.runs.getByStatus('running');
  const strandedRunningInstances = runningInstances.filter((inst) => {
    const idleMs = now.getTime() - new Date(inst.updatedAt).getTime();
    return idleMs > STRANDED_RUNNING_BOUND_MS;
  });

  for (const inst of strandedRunningInstances) {
    try {
      await scope.system.runKicker.kick(inst.id, { triggeredBy: 'cron-heartbeat' });
      await scope.system.audit.append({
        actorId: 'cron-heartbeat',
        actorType: 'system',
        actorRole: 'scheduler',
        action: 'instance.stranded_rekicked',
        description: `Stranded running run '${inst.id}' re-kicked (idle past the ${STRANDED_RUNNING_BOUND_MS / 60000}-minute bound)`,
        timestamp: now.toISOString(),
        inputSnapshot: {
          runId: inst.id,
          currentStepId: inst.currentStepId,
          updatedAt: inst.updatedAt,
        },
        outputSnapshot: { reKick: true },
        basis: 'Heartbeat stranded-running sweep: run idle past the step-timeout bound',
        entityType: 'processInstance',
        entityId: inst.id,
        processInstanceId: inst.id,
        processDefinitionVersion: inst.definitionVersion,
      });
      console.log(`[cron-heartbeat] Re-kicked stranded running run '${inst.id}' (step: ${inst.currentStepId})`);
    } catch (err) {
      console.error(`[cron-heartbeat] Failed to re-kick stranded run '${inst.id}':`, err);
    }
  }

  return { triggered, skipped };
}
