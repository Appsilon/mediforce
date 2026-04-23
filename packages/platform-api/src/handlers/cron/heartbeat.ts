import type {
  CronTriggerStateRepository,
  ProcessRepository,
  Trigger,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import type { HeartbeatInput, HeartbeatOutput } from '../../contract/cron.js';
import type { TriggerRun } from '../tasks/complete-task.js';

export interface CronTriggerLike {
  fireWorkflow(context: {
    definitionName: string;
    definitionVersion: number;
    triggerName: string;
    triggeredBy: string;
    payload: Record<string, unknown>;
  }): Promise<{ instanceId: string; status: string }>;
}

export interface CronScheduleValidator {
  validateCronSchedule(schedule: string): { valid: boolean; error?: string };
  isDue(schedule: string, now: Date, lastTriggeredAt: Date | undefined): boolean;
}

export interface HeartbeatDeps {
  processRepo: Pick<ProcessRepository, 'listWorkflowDefinitions'>;
  cronTrigger: CronTriggerLike;
  cronTriggerStateRepo: CronTriggerStateRepository;
  scheduleValidator: CronScheduleValidator;
  now?: () => Date;
  triggerRun?: TriggerRun;
}

/**
 * Pure handler for `POST /api/cron/heartbeat`. Walks the latest version of
 * every non-archived workflow definition, inspects its cron triggers, and
 * fires each one that's due. State is persisted after a successful fire so
 * we get at-least-once semantics (duplicate fires are possible under
 * overlapping heartbeats — see the route-level note).
 */
export async function heartbeat(
  _input: HeartbeatInput,
  deps: HeartbeatDeps,
): Promise<HeartbeatOutput> {
  const now = (deps.now ?? (() => new Date()))();
  const triggered: HeartbeatOutput['triggered'] = [];
  const skipped: HeartbeatOutput['skipped'] = [];

  const { definitions: definitionGroups } =
    await deps.processRepo.listWorkflowDefinitions();

  const cronDefinitions = definitionGroups
    .map((group) => group.versions.find((v) => v.version === group.latestVersion))
    .filter((def): def is WorkflowDefinition => def !== undefined)
    .filter(
      (def) =>
        def.archived !== true &&
        def.triggers.some((t: Trigger) => t.type === 'cron'),
    );

  for (const def of cronDefinitions) {
    const cronTriggers = def.triggers.filter((t: Trigger) => t.type === 'cron');

    for (const trigger of cronTriggers) {
      const schedule = trigger.schedule;
      if (schedule === undefined) {
        skipped.push({
          definitionName: def.name,
          definitionVersion: def.version,
          triggerName: trigger.name,
          reason: 'No schedule defined',
        });
        continue;
      }

      const validation = deps.scheduleValidator.validateCronSchedule(schedule);
      if (!validation.valid) {
        skipped.push({
          definitionName: def.name,
          definitionVersion: def.version,
          triggerName: trigger.name,
          reason: `Invalid schedule: ${validation.error ?? 'unknown'}`,
        });
        continue;
      }

      const state = await deps.cronTriggerStateRepo.get(def.name, trigger.name);
      const lastTriggeredAt = state !== null
        ? new Date(state.lastTriggeredAt)
        : def.createdAt !== undefined
          ? new Date(def.createdAt)
          : undefined;

      if (!deps.scheduleValidator.isDue(schedule, now, lastTriggeredAt)) {
        skipped.push({
          definitionName: def.name,
          definitionVersion: def.version,
          triggerName: trigger.name,
          reason: 'Not due',
        });
        continue;
      }

      const result = await deps.cronTrigger.fireWorkflow({
        definitionName: def.name,
        definitionVersion: def.version,
        triggerName: trigger.name,
        triggeredBy: 'cron-heartbeat',
        payload: { schedule, firedAt: now.toISOString() },
      });

      await deps.cronTriggerStateRepo.set({
        definitionName: def.name,
        triggerName: trigger.name,
        lastTriggeredAt: now.toISOString(),
      });

      if (deps.triggerRun !== undefined) {
        deps.triggerRun(result.instanceId, 'cron-heartbeat');
      }

      triggered.push({
        definitionName: def.name,
        definitionVersion: def.version,
        triggerName: trigger.name,
        instanceId: result.instanceId,
      });
    }
  }

  return { triggered, skipped };
}
