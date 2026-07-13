import type { CronTriggerState } from '@mediforce/platform-core';
import { validateCronSchedule } from '@mediforce/workflow-engine';
import type {
  CreateCronTriggerInput,
  CreateCronTriggerOutput,
  DeleteCronTriggerInput,
  DeleteCronTriggerOutput,
  ListCronTriggersInput,
  ListCronTriggersOutput,
  SetCronTriggerEnabledInput,
  SetCronTriggerEnabledOutput,
  UpdateCronTriggerInput,
  UpdateCronTriggerOutput,
} from '../../contract/cron-triggers';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, NotFoundError, ValidationError } from '../../errors';
import { actorFromCaller, loadOr404 } from '../_helpers';

function assertValidSchedule(schedule: string): void {
  const validation = validateCronSchedule(schedule);
  if (!validation.valid) {
    throw new ValidationError(`Invalid cron schedule: ${validation.error}`);
  }
}

// A Cron Trigger can only attach to an existing, visible, non-deleted workflow.
async function assertWorkflowExists(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
): Promise<void> {
  const latest = await scope.workflowDefinitions.getLatestVersion(namespace, definitionName);
  const deleted = await scope.workflowDefinitions.isNameDeleted(namespace, definitionName);
  if (!latest || deleted) {
    throw new NotFoundError(`Workflow '${definitionName}' not found in '${namespace}'`);
  }
}

async function loadTriggerOr404(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
  triggerName: string,
): Promise<CronTriggerState> {
  return loadOr404(
    scope.cron.get(namespace, definitionName, triggerName),
    `Cron trigger '${triggerName}' not found for '${definitionName}'`,
  );
}

export async function listCronTriggers(
  input: ListCronTriggersInput,
  scope: CallerScope,
): Promise<ListCronTriggersOutput> {
  const triggers = await scope.cron.listByDefinition(input.namespace, input.definitionName);
  return { triggers };
}

export async function createCronTrigger(
  input: CreateCronTriggerInput,
  scope: CallerScope,
): Promise<CreateCronTriggerOutput> {
  assertValidSchedule(input.schedule);
  await assertWorkflowExists(scope, input.namespace, input.definitionName);

  const existing = await scope.cron.get(input.namespace, input.definitionName, input.triggerName);
  if (existing !== null) {
    throw new ConflictError(
      `Cron trigger '${input.triggerName}' already exists for '${input.definitionName}'`,
    );
  }

  const trigger: CronTriggerState = {
    namespace: input.namespace,
    definitionName: input.definitionName,
    triggerName: input.triggerName,
    schedule: input.schedule,
    enabled: input.enabled,
    // Anchor the fire cursor to creation time so the schedule starts at its next
    // slot rather than backfiring history from the (possibly old) workflow's
    // createdAt on the next heartbeat.
    lastTriggeredAt: new Date().toISOString(),
  };
  await scope.cron.create(trigger);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'cron.trigger.created',
    description: `Cron trigger '${input.triggerName}' created for '${input.definitionName}' (${input.schedule})`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      schedule: input.schedule,
      enabled: input.enabled,
    },
    outputSnapshot: { enabled: input.enabled },
    basis: 'Cron trigger created via API',
    entityType: 'cronTrigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { trigger };
}

export async function updateCronTrigger(
  input: UpdateCronTriggerInput,
  scope: CallerScope,
): Promise<UpdateCronTriggerOutput> {
  assertValidSchedule(input.schedule);
  await loadTriggerOr404(scope, input.namespace, input.definitionName, input.triggerName);

  await scope.cron.update(input.namespace, input.definitionName, input.triggerName, {
    schedule: input.schedule,
  });
  const trigger = await loadTriggerOr404(
    scope,
    input.namespace,
    input.definitionName,
    input.triggerName,
  );

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'cron.trigger.updated',
    description: `Cron trigger '${input.triggerName}' schedule set to '${input.schedule}' for '${input.definitionName}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      schedule: input.schedule,
    },
    outputSnapshot: { schedule: input.schedule },
    basis: 'Cron trigger schedule updated via API',
    entityType: 'cronTrigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { trigger };
}

export async function setCronTriggerEnabled(
  input: SetCronTriggerEnabledInput,
  scope: CallerScope,
): Promise<SetCronTriggerEnabledOutput> {
  await loadTriggerOr404(scope, input.namespace, input.definitionName, input.triggerName);

  await scope.cron.update(input.namespace, input.definitionName, input.triggerName, {
    enabled: input.enabled,
  });
  const trigger = await loadTriggerOr404(
    scope,
    input.namespace,
    input.definitionName,
    input.triggerName,
  );

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: input.enabled ? 'cron.trigger.enabled' : 'cron.trigger.disabled',
    description: `Cron trigger '${input.triggerName}' ${input.enabled ? 'started' : 'stopped'} for '${input.definitionName}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      enabled: input.enabled,
    },
    outputSnapshot: { enabled: input.enabled },
    basis: 'Cron trigger enabled state changed via API',
    entityType: 'cronTrigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { trigger };
}

export async function deleteCronTrigger(
  input: DeleteCronTriggerInput,
  scope: CallerScope,
): Promise<DeleteCronTriggerOutput> {
  await loadTriggerOr404(scope, input.namespace, input.definitionName, input.triggerName);

  await scope.cron.delete(input.namespace, input.definitionName, input.triggerName);

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
    basis: 'Cron trigger deleted via API',
    entityType: 'cronTrigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  return { success: true as const };
}
