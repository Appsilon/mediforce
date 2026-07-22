import type {
  CronTriggerResource,
  ProcessInstance,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import { resolveStrandedBudgetMs } from '@mediforce/platform-core';
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

// Fallback age used only when a run's current step (or its definition) can't be
// resolved: the runtime's default step timeout + grace, derived from the same
// shared budget helper as the live path (`resolveStrandedBudgetMs`) by passing a
// step with no configured timeout. The live path below derives the bound from
// the current step's *configured* timeout so a step that legitimately runs
// longer than the default is never mistaken for stranded.
export const STRANDED_RUNNING_THRESHOLD_MS = resolveStrandedBudgetMs({});

// Longest a `running` instance may sit idle (no `updatedAt` refresh) before its
// driver is presumed dead: the current step's effective timeout + grace. Falls
// back to the default bound when the step or its definition can't be loaded.
// Single-sources the timeout + grace with the driver's reap bound (ADR-0010) via
// resolveStrandedBudgetMs so the sweep and reap thresholds can't drift.
async function strandedBudgetMs(
  inst: ProcessInstance,
  scope: CallerScope,
): Promise<number> {
  if (inst.currentStepId === null) return STRANDED_RUNNING_THRESHOLD_MS;
  try {
    const version = parseInt(inst.definitionVersion, 10);
    const def = Number.isNaN(version)
      ? null
      : await scope.workflowDefinitions.get(inst.namespace ?? '', inst.definitionName, version);
    const step = def?.steps.find((s) => s.id === inst.currentStepId);
    if (step === undefined) return STRANDED_RUNNING_THRESHOLD_MS;
    return resolveStrandedBudgetMs(step);
  } catch {
    return STRANDED_RUNNING_THRESHOLD_MS;
  }
}

function evaluateTrigger(
  trigger: CronTriggerResource,
  definitionCreatedAt: string | undefined,
  now: Date,
): Evaluation {
  const schedule = trigger.config.schedule;

  const validation = validateCronSchedule(schedule);
  if (!validation.valid) return { fire: false, reason: `Invalid schedule: ${validation.error}` };

  const lastTriggeredAt = trigger.lastTriggeredAt
    ? new Date(trigger.lastTriggeredAt)
    : definitionCreatedAt
      ? new Date(definitionCreatedAt)
      : undefined;
  if (!isDue(schedule, now, lastTriggeredAt)) return { fire: false, reason: 'Not due' };

  return { fire: true };
}

type Resolution = { ok: true; def: WorkflowDefinition } | { ok: false; reason: string };

// Resolve the Workflow Definition version a Cron Trigger fires (ADR-0011):
// the workflow's default version when it is itself runnable, otherwise the
// newest live (non-archived, non-deleted) version. Both the default pointer and
// `getLatestVersion` include archived versions, so selecting from them directly
// would skip a workflow whose head is archived even though an earlier version
// is still runnable. Skips deleted or fully-archived targets so a stale row can
// never fire a ghost run.
async function resolveTarget(
  scope: CallerScope,
  namespace: string,
  workflowName: string,
): Promise<Resolution> {
  if (await scope.workflowDefinitions.isNameDeleted(namespace, workflowName)) {
    return { ok: false, reason: 'Workflow deleted' };
  }
  const versions = await scope.workflowDefinitions.listVersions(namespace, workflowName);
  if (versions.length === 0) return { ok: false, reason: 'No resolvable version' };

  const live = versions.filter((v) => v.archived !== true && v.deleted !== true);
  if (live.length === 0) return { ok: false, reason: 'No live version' };

  const defaultVersion = await scope.workflowDefinitions.getDefaultVersion(namespace, workflowName);
  const def =
    live.find((v) => v.version === defaultVersion) ??
    live.reduce((newest, v) => (v.version > newest.version ? v : newest));
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

  // Row-driven (ADR-0011): the unified `triggers` table is the source of truth
  // for what fires, not the Definition's declared trigger array. Enabled cron
  // rows across every workspace (system-actor read).
  const cronRows = await scope.system.triggers.listEnabledByType('cron');
  const cronTriggers = cronRows.filter(
    (row): row is CronTriggerResource => row.type === 'cron',
  );

  for (const trigger of cronTriggers) {
    const resolution = await resolveTarget(scope, trigger.namespace, trigger.workflowName);
    if (!resolution.ok) {
      skipped.push({
        definitionName: trigger.workflowName,
        definitionVersion: 0,
        triggerName: trigger.name,
        reason: resolution.reason,
      });
      console.log(
        `[cron-heartbeat] skip '${trigger.workflowName}/${trigger.name}': ${resolution.reason}`,
      );
      continue;
    }

    const def = resolution.def;
    const entryHead = {
      definitionName: trigger.workflowName,
      definitionVersion: def.version,
      triggerName: trigger.name,
    };

    const evaluation = evaluateTrigger(trigger, def.createdAt, now);
    if (!evaluation.fire) {
      skipped.push({ ...entryHead, reason: evaluation.reason });
      console.log(`[cron-heartbeat] skip '${trigger.workflowName}/${trigger.name}': ${evaluation.reason}`);
      continue;
    }

    const result = await scope.system.cronTrigger.fireWorkflow({
      namespace: def.namespace,
      definitionName: def.name,
      definitionVersion: def.version,
      triggerName: trigger.name,
      triggeredBy: 'cron-heartbeat',
      payload: { schedule: trigger.config.schedule, firedAt: now.toISOString() },
    });

    // Advance the fire cursor AFTER a successful fire (at-least-once semantics).
    await scope.system.triggers.recordTriggered(
      trigger.namespace,
      trigger.workflowName,
      trigger.name,
      now.toISOString(),
    );

    await scope.system.audit.append({
      actorId: 'cron-heartbeat',
      actorType: 'system',
      actorRole: 'scheduler',
      action: 'cron.trigger.fired',
      description: `Cron trigger '${trigger.name}' fired for '${def.name}' v${def.version}`,
      timestamp: now.toISOString(),
      inputSnapshot: { ...entryHead, namespace: trigger.namespace, schedule: trigger.config.schedule },
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

  // Sweep: re-kick runs stranded in `running`. Their driving auto-runner
  // request died mid-step, leaving status=running with no process advancing
  // them — the paused sweeps above only query `paused`, so nothing else can
  // ever see them and they sit at their current step indefinitely. A re-kick
  // re-enters the /run loop from the current step. It is idempotent: /run
  // rejects the POST with 409 while a live driver still holds the per-process
  // lock, so this only advances runs whose driver is genuinely gone.
  // (Contrast the orphan sweep above, which *fails* paused/null runs — a
  // paused run cannot be re-kicked because /run requires status=running.)
  const runningInstances = await scope.runs.getByStatus('running');

  for (const inst of runningInstances) {
    const idleMs = now.getTime() - new Date(inst.updatedAt).getTime();
    // Derive the bound from the current step's own timeout so a step that
    // legitimately runs longer than the default is never mistaken for stranded.
    const budgetMs = await strandedBudgetMs(inst, scope);
    if (idleMs < budgetMs) continue;

    const idleMinutes = Math.round(idleMs / 60000);
    try {
      await scope.system.audit.append({
        actorId: 'cron-heartbeat',
        actorType: 'system',
        actorRole: 'scheduler',
        action: 'instance.stranded_rekicked',
        // "attempted", not "re-kicked": runKicker.kick is fire-and-forget and
        // gives no completion signal, so this records the sweep's action, not
        // that the run necessarily advanced (a still-live driver 409s the POST).
        description: `Stranded running run '${inst.id}' re-kick attempted (idle ${idleMinutes}m at step '${inst.currentStepId}')`,
        timestamp: now.toISOString(),
        inputSnapshot: { runId: inst.id, currentStepId: inst.currentStepId, idleMinutes },
        outputSnapshot: {},
        basis: 'Heartbeat stranded sweep: running run with no live auto-runner',
        entityType: 'processInstance',
        entityId: inst.id,
        processInstanceId: inst.id,
        processDefinitionVersion: inst.definitionVersion,
      });
      await scope.system.runKicker.kick(inst.id, { triggeredBy: 'cron-heartbeat-stranded' });
      console.log(`[cron-heartbeat] Re-kick attempted for stranded running run '${inst.id}' (step: ${inst.currentStepId}, idle ${idleMinutes}m)`);
    } catch (err) {
      console.error(`[cron-heartbeat] Failed to re-kick stranded run '${inst.id}':`, err);
    }
  }

  return { triggered, skipped };
}
