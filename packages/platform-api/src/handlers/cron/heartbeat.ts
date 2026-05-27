import type { CronTriggerState, Trigger, WorkflowDefinition } from '@mediforce/platform-core';
import { validateCronSchedule, isDue } from '@mediforce/workflow-engine';
import type {
  HeartbeatInput,
  HeartbeatOutput,
  SkippedEntry,
  TriggeredEntry,
} from '../../contract/cron.js';
import type { CallerScope } from '../../repositories/index.js';
import { ForbiddenError } from '../../errors.js';
import { resumeWait } from '../processes/resume-wait.js';

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
    } catch {
      // resumeWait throws PreconditionFailedError if not ready yet — expected
    }
  }

  return { triggered, skipped };
}
