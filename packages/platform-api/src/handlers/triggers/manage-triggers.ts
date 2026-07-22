import type { CronTriggerResource, TriggerResource } from '@mediforce/platform-core';
import { validateCronSchedule } from '@mediforce/workflow-engine';
import type {
  CreateTriggerInput,
  CreateTriggerOutput,
  DeleteTriggerInput,
  DeleteTriggerOutput,
  ListTriggersInput,
  ListTriggersOutput,
  SetTriggerEnabledInput,
  SetTriggerEnabledOutput,
  UpdateTriggerInput,
  UpdateTriggerOutput,
} from '../../contract/triggers';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { actorFromCaller } from '../_helpers';

function assertValidSchedule(schedule: string): void {
  const validation = validateCronSchedule(schedule);
  if (!validation.valid) {
    throw new ValidationError(`Invalid cron schedule: ${validation.error}`);
  }
}

// A Trigger can only attach to an existing, visible, non-deleted workflow.
async function assertWorkflowExists(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
): Promise<void> {
  const latest = await scope.workflowDefinitions.getLatestVersion(namespace, definitionName);
  const deleted = await scope.workflowDefinitions.isNameDeleted(namespace, definitionName);
  if (latest === 0 || deleted) {
    throw new NotFoundError(`Workflow '${definitionName}' not found in '${namespace}'`);
  }
}

async function loadTrigger(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
  triggerName: string,
): Promise<TriggerResource | null> {
  const triggers = await scope.triggers.listByWorkflow(namespace, definitionName);
  return triggers.find((t) => t.name === triggerName) ?? null;
}

async function loadTriggerOr404(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
  triggerName: string,
): Promise<TriggerResource> {
  const trigger = await loadTrigger(scope, namespace, definitionName, triggerName);
  if (trigger === null) {
    throw new NotFoundError(`Trigger '${triggerName}' not found for '${definitionName}'`);
  }
  return trigger;
}

export async function listTriggers(
  input: ListTriggersInput,
  scope: CallerScope,
): Promise<ListTriggersOutput> {
  const triggers = await scope.triggers.listByWorkflow(input.namespace, input.definitionName);
  return { triggers };
}

export async function createTrigger(
  input: CreateTriggerInput,
  scope: CallerScope,
): Promise<CreateTriggerOutput> {
  if (input.type !== 'cron') {
    throw new ValidationError(`Trigger type '${input.type}' is not yet supported`);
  }
  assertValidSchedule(input.schedule);
  await assertWorkflowExists(scope, input.namespace, input.definitionName);

  const existing = await loadTrigger(
    scope,
    input.namespace,
    input.definitionName,
    input.triggerName,
  );
  if (existing !== null) {
    throw new ConflictError(
      `Trigger '${input.triggerName}' already exists for '${input.definitionName}'`,
    );
  }

  const now = new Date().toISOString();
  const trigger: CronTriggerResource = {
    type: 'cron',
    namespace: input.namespace,
    workflowName: input.definitionName,
    name: input.triggerName,
    enabled: input.enabled,
    config: { schedule: input.schedule },
    // Anchor the fire cursor to creation time so the schedule starts at its next
    // slot rather than back-firing history from the workflow's createdAt on the
    // next heartbeat.
    lastTriggeredAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const created = await scope.triggers.create(trigger);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'cron.trigger.created',
    description: `Cron trigger '${input.triggerName}' created for '${input.definitionName}' (${input.schedule})`,
    timestamp: now,
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      schedule: input.schedule,
      enabled: input.enabled,
    },
    outputSnapshot: { enabled: input.enabled },
    basis: 'Trigger created via API',
    entityType: 'trigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { trigger: created };
}

export async function updateTrigger(
  input: UpdateTriggerInput,
  scope: CallerScope,
): Promise<UpdateTriggerOutput> {
  assertValidSchedule(input.schedule);
  await loadTriggerOr404(scope, input.namespace, input.definitionName, input.triggerName);

  const now = new Date().toISOString();
  const trigger = await scope.triggers.update(
    input.namespace,
    input.definitionName,
    input.triggerName,
    { config: { schedule: input.schedule }, updatedAt: now },
  );

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'cron.trigger.updated',
    description: `Cron trigger '${input.triggerName}' schedule set to '${input.schedule}' for '${input.definitionName}'`,
    timestamp: now,
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      schedule: input.schedule,
    },
    outputSnapshot: { schedule: input.schedule },
    basis: 'Trigger schedule updated via API',
    entityType: 'trigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { trigger };
}

export async function setTriggerEnabled(
  input: SetTriggerEnabledInput,
  scope: CallerScope,
): Promise<SetTriggerEnabledOutput> {
  await loadTriggerOr404(scope, input.namespace, input.definitionName, input.triggerName);

  const now = new Date().toISOString();
  let trigger = await scope.triggers.update(
    input.namespace,
    input.definitionName,
    input.triggerName,
    { enabled: input.enabled, updatedAt: now },
  );

  // Re-anchor the cron fire cursor to start time on re-enable so a schedule
  // that was stopped across one of its slots never back-fires the missed run
  // on the next heartbeat. No-op for non-cron rows.
  if (input.enabled && trigger.type === 'cron') {
    await scope.triggers.recordTriggered(
      input.namespace,
      input.definitionName,
      input.triggerName,
      now,
    );
    trigger = { ...trigger, lastTriggeredAt: now };
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: input.enabled ? 'cron.trigger.enabled' : 'cron.trigger.disabled',
    description: `Cron trigger '${input.triggerName}' ${input.enabled ? 'started' : 'stopped'} for '${input.definitionName}'`,
    timestamp: now,
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      enabled: input.enabled,
    },
    outputSnapshot: { enabled: input.enabled },
    basis: 'Trigger enabled state changed via API',
    entityType: 'trigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { trigger };
}

export async function deleteTrigger(
  input: DeleteTriggerInput,
  scope: CallerScope,
): Promise<DeleteTriggerOutput> {
  await loadTriggerOr404(scope, input.namespace, input.definitionName, input.triggerName);

  await scope.triggers.delete(input.namespace, input.definitionName, input.triggerName);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'cron.trigger.deleted',
    description: `Cron trigger '${input.triggerName}' deleted for '${input.definitionName}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
    },
    outputSnapshot: { deleted: true },
    basis: 'Trigger deleted via API',
    entityType: 'trigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { success: true as const };
}
