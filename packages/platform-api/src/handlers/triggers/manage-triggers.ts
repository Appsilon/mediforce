import type {
  CronTriggerResource,
  ManualTriggerResource,
  TriggerResource,
  WebhookTriggerResource,
} from '@mediforce/platform-core';
import { WebhookTriggerConfigSchema } from '@mediforce/platform-core';
import { validateCronSchedule } from '@mediforce/workflow-engine';
import { toPortableTrigger } from '@mediforce/platform-core';
import type { PortableTrigger } from '@mediforce/platform-core';
import type {
  CreateTriggerInput,
  CreateTriggerOutput,
  DeleteTriggerInput,
  DeleteTriggerOutput,
  ExportTriggersInput,
  ExportTriggersOutput,
  ImportedTriggerResult,
  ImportTriggersInput,
  ImportTriggersOutput,
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

function labelFor(type: TriggerResource['type']): string {
  if (type === 'cron') return 'Cron';
  if (type === 'manual') return 'Manual';
  return 'Webhook';
}

function assertValidSchedule(schedule: string): void {
  const validation = validateCronSchedule(schedule);
  if (!validation.valid) {
    throw new ValidationError(`Invalid cron schedule: ${validation.error}`);
  }
}

/** Append the `<type>.trigger.deleted` audit event for a removed row. Shared by
 *  `deleteTrigger` and the import/replace path, which drops rows through the
 *  repo directly (bypassing `deleteTrigger`) and so must audit the removal
 *  itself rather than leave it off the trail. */
async function auditTriggerDeleted(
  scope: CallerScope,
  namespace: string,
  definitionName: string,
  trigger: TriggerResource,
  basis: string,
): Promise<void> {
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: `${trigger.type}.trigger.deleted`,
    description: `${labelFor(trigger.type)} trigger '${trigger.name}' deleted for '${definitionName}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, definitionName, triggerName: trigger.name },
    outputSnapshot: { deleted: true },
    basis,
    entityType: 'trigger',
    entityId: `${definitionName}/${trigger.name}`,
    namespace,
  });
}

/** The relative endpoint a webhook trigger listens on. Matches the catch-all
 *  route `/api/triggers/webhook/<namespace>/<workflow>/<suffix>` — `path`
 *  already starts with `/`, so it is the suffix verbatim. */
function webhookUrlFor(trigger: WebhookTriggerResource): string {
  return `/api/triggers/webhook/${trigger.namespace}/${trigger.workflowName}${trigger.config.path}`;
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
  await assertWorkflowExists(scope, input.namespace, input.definitionName);

  const workflowTriggers = await scope.triggers.listByWorkflow(
    input.namespace,
    input.definitionName,
  );
  const existing = workflowTriggers.find((t) => t.name === input.triggerName) ?? null;
  if (existing !== null) {
    throw new ConflictError(
      `Trigger '${input.triggerName}' already exists for '${input.definitionName}'`,
    );
  }
  // A workflow has at most one manual trigger — it is the singleton switch that
  // makes the workflow hand-startable (Issue #930). Reject a second.
  if (input.type === 'manual' && workflowTriggers.some((t) => t.type === 'manual')) {
    throw new ConflictError(
      `'${input.definitionName}' already has a manual trigger`,
    );
  }
  // A workflow has at most one webhook trigger — enforced here, not just in the
  // UI (Issue #931). The underlying table stays many-capable for the future.
  if (input.type === 'webhook' && workflowTriggers.some((t) => t.type === 'webhook')) {
    throw new ConflictError(
      `'${input.definitionName}' already has a webhook trigger`,
    );
  }

  const hasSchedule = typeof input.schedule === 'string' && input.schedule.length > 0;
  const hasWebhookConfig = input.method !== undefined || input.path !== undefined;

  const now = new Date().toISOString();
  let trigger: TriggerResource;
  if (input.type === 'cron') {
    if (!hasSchedule) {
      throw new ValidationError('A cron trigger requires a schedule');
    }
    if (hasWebhookConfig) {
      throw new ValidationError('A cron trigger does not take a method or path');
    }
    assertValidSchedule(input.schedule as string);
    const cron: CronTriggerResource = {
      type: 'cron',
      namespace: input.namespace,
      workflowName: input.definitionName,
      name: input.triggerName,
      enabled: input.enabled,
      config: { schedule: input.schedule as string },
      // Anchor the fire cursor to creation time so the schedule starts at its next
      // slot rather than back-firing history from the workflow's createdAt on the
      // next heartbeat.
      lastTriggeredAt: now,
      createdAt: now,
      updatedAt: now,
    };
    trigger = cron;
  } else if (input.type === 'webhook') {
    if (hasSchedule) {
      throw new ValidationError('A webhook trigger does not take a schedule');
    }
    // The catch-all endpoint dispatches POST only, so POST is the sole method a
    // webhook trigger can ever fire on — default it and reject anything else,
    // rather than persisting a row that silently 405s. `path` is the webhook's
    // identity; its format (leading slash, url-safe chars) is validated by the
    // shared config schema so CLI and UI reject identically.
    const method = input.method ?? 'POST';
    if (method !== 'POST') {
      throw new ValidationError(
        `A webhook trigger only accepts POST (the endpoint dispatches POST only), got ${method}`,
      );
    }
    const config = WebhookTriggerConfigSchema.safeParse({
      method,
      path: input.path,
    });
    if (!config.success) {
      throw new ValidationError(
        `Invalid webhook config: ${config.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const webhook: WebhookTriggerResource = {
      type: 'webhook',
      namespace: input.namespace,
      workflowName: input.definitionName,
      name: input.triggerName,
      enabled: input.enabled,
      config: config.data,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    trigger = webhook;
  } else {
    if (hasSchedule) {
      throw new ValidationError('A manual trigger does not take a schedule');
    }
    if (hasWebhookConfig) {
      throw new ValidationError('A manual trigger does not take a method or path');
    }
    const manual: ManualTriggerResource = {
      type: 'manual',
      namespace: input.namespace,
      workflowName: input.definitionName,
      name: input.triggerName,
      enabled: input.enabled,
      config: {},
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    trigger = manual;
  }
  const created = await scope.triggers.create(trigger);

  let configSuffix = '';
  if (trigger.type === 'cron') configSuffix = ` (${trigger.config.schedule})`;
  else if (trigger.type === 'webhook') {
    configSuffix = ` (${trigger.config.method} ${trigger.config.path})`;
  }
  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: `${input.type}.trigger.created`,
    description: `${labelFor(input.type)} trigger '${input.triggerName}' created for '${input.definitionName}'${configSuffix}`,
    timestamp: now,
    inputSnapshot: {
      namespace: input.namespace,
      definitionName: input.definitionName,
      triggerName: input.triggerName,
      type: input.type,
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
      ...(input.method === undefined ? {} : { method: input.method }),
      ...(input.path === undefined ? {} : { path: input.path }),
      enabled: input.enabled,
    },
    outputSnapshot: { enabled: input.enabled },
    basis: 'Trigger created via API',
    entityType: 'trigger',
    entityId: `${input.definitionName}/${input.triggerName}`,
    namespace: input.namespace,
  });

  const webhookUrl = created.type === 'webhook' ? webhookUrlFor(created) : null;
  return { trigger: created, webhookUrl };
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
  const current = await loadTriggerOr404(
    scope,
    input.namespace,
    input.definitionName,
    input.triggerName,
  );

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
    action: `${current.type}.trigger.${input.enabled ? 'enabled' : 'disabled'}`,
    description: `${labelFor(current.type)} trigger '${input.triggerName}' ${input.enabled ? 'started' : 'stopped'} for '${input.definitionName}'`,
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

/**
 * Export a workflow's triggers to the portable, instance-free file shape
 * (Issue #933). Strips every runtime/instance field — namespace, workflowName,
 * the cron fire cursor, the derived callable URL — so the result carries only
 * config that transfers between instances.
 */
export async function exportTriggers(
  input: ExportTriggersInput,
  scope: CallerScope,
): Promise<ExportTriggersOutput> {
  await assertWorkflowExists(scope, input.namespace, input.definitionName);
  const triggers = await scope.triggers.listByWorkflow(input.namespace, input.definitionName);
  return { triggers: triggers.map(toPortableTrigger) };
}

/** Map a portable entry onto the create-trigger input for the target workflow. */
function createInputFor(input: ImportTriggersInput, entry: PortableTrigger): CreateTriggerInput {
  const common = {
    namespace: input.namespace,
    definitionName: input.definitionName,
    triggerName: entry.name,
    enabled: entry.enabled,
  };
  if (entry.type === 'cron') {
    return { ...common, type: 'cron', schedule: entry.schedule };
  }
  if (entry.type === 'webhook') {
    return { ...common, type: 'webhook', method: entry.method, path: entry.path };
  }
  return { ...common, type: 'manual' };
}

/** Every existing row a portable entry collides with. A same-name row is one
 *  collision; `manual` and `webhook` are also per-workflow singletons, so a
 *  *differently*-named row of the same type is a second, independent collision.
 *  `createTrigger` would 409 on either, so `replace` must reconcile against ALL
 *  of them — returning a single conflict silently deletes one and then 409s on
 *  the other, a partial import. The two can point at different rows (e.g. a
 *  webhook entry named `manual` collides by name with the manual singleton and
 *  by type with the existing webhook). */
function conflictsFor(existing: TriggerResource[], entry: PortableTrigger): TriggerResource[] {
  const conflicts: TriggerResource[] = [];
  const byName = existing.find((t) => t.name === entry.name);
  if (byName !== undefined) conflicts.push(byName);
  if (entry.type === 'manual' || entry.type === 'webhook') {
    const singleton = existing.find((t) => t.type === entry.type && t.name !== entry.name);
    if (singleton !== undefined) conflicts.push(singleton);
  }
  return conflicts;
}

/**
 * Import a portable trigger-config file into a workflow (Issue #933),
 * materializing rows in the target namespace. Reuses `createTrigger` per entry
 * so import inherits its resolution for free: webhook URLs are re-derived for
 * the target host, cron cursors anchor to `now` (no back-fire), config is
 * validated, and each create is audited. Conflict policy is seed-if-absent —
 * a colliding trigger is skipped unless `replace` is set, which drops the
 * existing row first and recreates it from the file.
 *
 * Validate every entry before writing anything: import is non-transactional, so
 * any rule `createTrigger` enforces but the file schema can't must reject the
 * whole file up front rather than leave the already-created entries behind as a
 * partial write. Two such rules exist — cron schedule alignment, and webhook
 * POST-only (`PortableWebhookTriggerSchema` accepts every `HttpMethodSchema`
 * verb, so a backfilled/hand-authored file can carry a non-POST webhook that
 * only fails deep in `createTrigger`).
 */
export async function importTriggers(
  input: ImportTriggersInput,
  scope: CallerScope,
): Promise<ImportTriggersOutput> {
  await assertWorkflowExists(scope, input.namespace, input.definitionName);
  for (const entry of input.triggers) {
    if (entry.type === 'cron') assertValidSchedule(entry.schedule);
    if (entry.type === 'webhook' && entry.method !== 'POST') {
      throw new ValidationError(
        `A webhook trigger only accepts POST (the endpoint dispatches POST only), got ${entry.method}`,
      );
    }
  }

  let existing = await scope.triggers.listByWorkflow(input.namespace, input.definitionName);

  const results: ImportedTriggerResult[] = [];
  for (const entry of input.triggers) {
    const conflicts = conflictsFor(existing, entry);
    // The mandatory manual singleton (Issue #930) is never removable. A
    // non-manual entry that collides with it by name can't free the name
    // without destroying that invariant, so replace can't apply — skip the
    // entry rather than delete the manual row and then 409 anyway.
    const blockedByManual = conflicts.some((c) => c.type === 'manual' && entry.type !== 'manual');
    if (conflicts.length > 0 && (!input.replace || blockedByManual)) {
      results.push({ name: entry.name, type: entry.type, outcome: 'skipped', webhookUrl: null });
      continue;
    }
    // Replace: drop every colliding row directly (bypassing deleteTrigger's
    // manual guard) so the entry is recreated fresh from the file with a clean
    // cursor. The direct repo delete skips the handler's audit append, so emit
    // it here — a replaced row must still show on the trail.
    for (const conflict of conflicts) {
      await scope.triggers.delete(input.namespace, input.definitionName, conflict.name);
      await auditTriggerDeleted(
        scope,
        input.namespace,
        input.definitionName,
        conflict,
        'Trigger replaced during import',
      );
      existing = existing.filter((t) => t.name !== conflict.name);
    }
    const created = await createTrigger(createInputFor(input, entry), scope);
    results.push({
      name: entry.name,
      type: entry.type,
      outcome: conflicts.length > 0 ? 'replaced' : 'created',
      webhookUrl: created.webhookUrl,
    });
    existing = [...existing, created.trigger];
  }

  return { results };
}

export async function deleteTrigger(
  input: DeleteTriggerInput,
  scope: CallerScope,
): Promise<DeleteTriggerOutput> {
  const current = await loadTriggerOr404(
    scope,
    input.namespace,
    input.definitionName,
    input.triggerName,
  );
  // The manual trigger is the singleton hand-start switch — it can be stopped
  // but never removed, so the workflow always has one (Issue #930). Workflow
  // deletion still reaps it via the cascade (`deleteByWorkflow`).
  if (current.type === 'manual') {
    throw new ValidationError(
      'The manual trigger cannot be removed — stop it instead',
    );
  }

  await scope.triggers.delete(input.namespace, input.definitionName, input.triggerName);
  await auditTriggerDeleted(
    scope,
    input.namespace,
    input.definitionName,
    current,
    'Trigger deleted via API',
  );

  return { success: true as const };
}
