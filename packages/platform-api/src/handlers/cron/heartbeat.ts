import type { CronTriggerState, WorkflowDefinition } from '@mediforce/platform-core';
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
  trigger: CronTriggerState,
  definitionCreatedAt: string | undefined,
  now: Date,
): Evaluation {
  const validation = validateCronSchedule(trigger.schedule);
  if (!validation.valid) return { fire: false, reason: `Invalid schedule: ${validation.error}` };

  const lastTriggeredAt = trigger.lastTriggeredAt
    ? new Date(trigger.lastTriggeredAt)
    : definitionCreatedAt
      ? new Date(definitionCreatedAt)
      : undefined;
  if (!isDue(trigger.schedule, now, lastTriggeredAt)) return { fire: false, reason: 'Not due' };

  return { fire: true };
}

type Resolution =
  | { ok: true; def: WorkflowDefinition }
  | { ok: false; reason: string };

// Resolve the Workflow Definition version a Cron Trigger fires (ADR-0010):
// the workflow's default version, falling back to latest. Skips deleted,
// archived, or unresolvable targets so a stale row can never fire a ghost run.
async function resolveTarget(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
): Promise<Resolution> {
  if (await scope.workflowDefinitions.isNameDeleted(namespace, definitionName)) {
    return { ok: false, reason: 'Workflow deleted' };
  }
  const defaultVersion = await scope.workflowDefinitions.getDefaultVersion(
    namespace,
    definitionName,
  );
  const version =
    defaultVersion ?? (await scope.workflowDefinitions.getLatestVersion(namespace, definitionName));
  if (!version) return { ok: false, reason: 'No resolvable version' };

  const def = await scope.workflowDefinitions.get(namespace, definitionName, version);
  if (def === null) return { ok: false, reason: `Version ${version} not found` };
  if (def.deleted === true) return { ok: false, reason: 'Workflow deleted' };
  if (def.archived === true) return { ok: false, reason: 'Workflow archived' };
  return { ok: true, def };
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

  // Row-driven (ADR-0010): the Cron Trigger store is the source of truth for
  // what fires, not the Definition's declared trigger array.
  const cronTriggers = await scope.system.cron.listAllEnabled();

  for (const trigger of cronTriggers) {
    const resolution = await resolveTarget(scope, trigger.namespace, trigger.definitionName);
    if (!resolution.ok) {
      skipped.push({
        definitionName: trigger.definitionName,
        definitionVersion: 0,
        triggerName: trigger.triggerName,
        reason: resolution.reason,
      });
      console.log(
        `[cron-heartbeat] skip '${trigger.definitionName}/${trigger.triggerName}': ${resolution.reason}`,
      );
      continue;
    }

    const def = resolution.def;
    const entryHead = {
      definitionName: trigger.definitionName,
      definitionVersion: def.version,
      triggerName: trigger.triggerName,
    };

    const evaluation = evaluateTrigger(trigger, def.createdAt, now);
    if (!evaluation.fire) {
      skipped.push({ ...entryHead, reason: evaluation.reason });
      console.log(
        `[cron-heartbeat] skip '${trigger.definitionName}/${trigger.triggerName}': ${evaluation.reason}`,
      );
      continue;
    }

    const result = await scope.system.cronTrigger.fireWorkflow({
      namespace: def.namespace,
      definitionName: def.name,
      definitionVersion: def.version,
      triggerName: trigger.triggerName,
      triggeredBy: 'cron-heartbeat',
      payload: { schedule: trigger.schedule, firedAt: now.toISOString() },
    });

    // Advance the fire cursor AFTER a successful fire (at-least-once semantics).
    await scope.system.cron.recordTriggered(
      trigger.namespace,
      trigger.definitionName,
      trigger.triggerName,
      now.toISOString(),
    );

    await scope.system.audit.append({
      actorId: 'cron-heartbeat',
      actorType: 'system',
      actorRole: 'scheduler',
      action: 'cron.trigger.fired',
      description: `Cron trigger '${trigger.triggerName}' fired for '${def.name}' v${def.version}`,
      timestamp: now.toISOString(),
      inputSnapshot: { ...entryHead, namespace: trigger.namespace, schedule: trigger.schedule },
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

  return { triggered, skipped };
}
