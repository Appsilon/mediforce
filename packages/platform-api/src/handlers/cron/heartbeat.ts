import type { Trigger, WorkflowDefinition } from '@mediforce/platform-core';
import { validateCronSchedule, isDue } from '@mediforce/workflow-engine';
import type {
  HeartbeatInput,
  HeartbeatOutput,
  SkippedEntry,
  TriggeredEntry,
} from '../../contract/cron.js';
import type { CallerScope } from '../../repositories/index.js';
import { ForbiddenError } from '../../errors.js';

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
      const schedule = trigger.schedule;
      if (!schedule) {
        const reason = 'No schedule defined';
        skipped.push({ definitionName: def.name, definitionVersion: def.version, triggerName: trigger.name, reason });
        console.log(`[cron-heartbeat] skip '${def.name}/${trigger.name}': ${reason}`);
        continue;
      }

      const validation = validateCronSchedule(schedule);
      if (!validation.valid) {
        const reason = `Invalid schedule: ${validation.error}`;
        skipped.push({ definitionName: def.name, definitionVersion: def.version, triggerName: trigger.name, reason });
        console.log(`[cron-heartbeat] skip '${def.name}/${trigger.name}': ${reason}`);
        continue;
      }

      const state = await scope.cron.get(def.name, trigger.name);
      const lastTriggeredAt = state
        ? new Date(state.lastTriggeredAt)
        : def.createdAt
          ? new Date(def.createdAt)
          : undefined;

      if (!isDue(schedule, now, lastTriggeredAt)) {
        const reason = 'Not due';
        skipped.push({ definitionName: def.name, definitionVersion: def.version, triggerName: trigger.name, reason });
        console.log(`[cron-heartbeat] skip '${def.name}/${trigger.name}': ${reason}`);
        continue;
      }

      const result = await scope.system.cronTrigger.fireWorkflow({
        namespace: def.namespace,
        definitionName: def.name,
        definitionVersion: def.version,
        triggerName: trigger.name,
        triggeredBy: 'cron-heartbeat',
        payload: { schedule, firedAt: now.toISOString() },
      });

      // Persist trigger state AFTER successful fire (at-least-once semantics).
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
        inputSnapshot: {
          triggerName: trigger.name,
          definitionName: def.name,
          definitionVersion: def.version,
          schedule,
        },
        outputSnapshot: { instanceId: result.instanceId },
        basis: 'Cron trigger schedule due',
        entityType: 'processInstance',
        entityId: result.instanceId,
        processInstanceId: result.instanceId,
        processDefinitionVersion: String(def.version),
      });

      await scope.system.runKicker.kick(result.instanceId, {
        triggeredBy: 'cron-heartbeat',
      });

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
