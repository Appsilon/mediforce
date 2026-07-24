import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import {
  listTriggers,
  createTrigger,
  updateTrigger,
  setTriggerEnabled,
  deleteTrigger,
} from '../manage-triggers';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../errors';

describe('trigger handlers (cron on the unified table, ADR-0011)', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;
  let triggerRepo: InMemoryTriggerRepository;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    triggerRepo = new InMemoryTriggerRepository();
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow', version: 1, namespace: 'team-alpha' }),
    );
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      auditRepo,
      triggerRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  async function storedTrigger(name: string) {
    const rows = await triggerRepo.listByWorkflow('team-alpha', 'flow');
    return rows.find((t) => t.name === name) ?? null;
  }

  const base = { namespace: 'team-alpha', definitionName: 'flow', triggerName: 'nightly' };
  const cron = { ...base, type: 'cron' as const };
  const manual = {
    namespace: 'team-alpha',
    definitionName: 'flow',
    triggerName: 'manual',
    type: 'manual' as const,
  };
  const webhook = {
    namespace: 'team-alpha',
    definitionName: 'flow',
    triggerName: 'hook',
    type: 'webhook' as const,
    method: 'POST' as const,
    path: '/orders',
  };

  it('creates a cron trigger, persists it, and audits', async () => {
    const scope = buildScope();
    const result = await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);

    expect(result.trigger).toMatchObject({
      type: 'cron',
      namespace: 'team-alpha',
      workflowName: 'flow',
      name: 'nightly',
      enabled: true,
      config: { schedule: '0 3 * * *' },
    });
    // Cursor anchored to creation time so the schedule starts at its next slot.
    expect(result.trigger.type === 'cron' && result.trigger.lastTriggeredAt).not.toBeNull();
    const stored = await storedTrigger('nightly');
    expect(stored?.type === 'cron' && stored.config.schedule).toBe('0 3 * * *');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('cron.trigger.created');
    expect(events[0].actorId).toBe('user-42');
  });

  it('rejects an invalid (non-15-min-aligned) schedule', async () => {
    const scope = buildScope();
    await expect(
      createTrigger({ ...cron, schedule: '5 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a manual trigger (empty config, no fire cursor) and audits', async () => {
    const scope = buildScope();
    const result = await createTrigger({ ...manual, enabled: true }, scope);

    expect(result.trigger).toMatchObject({
      type: 'manual',
      namespace: 'team-alpha',
      workflowName: 'flow',
      name: 'manual',
      enabled: true,
      config: {},
    });
    expect(result.trigger.type === 'manual' && result.trigger.lastTriggeredAt).toBeNull();
    const events = auditRepo.getAll();
    expect(events[0].action).toBe('manual.trigger.created');
  });

  it('creates a disabled manual trigger when enabled is false', async () => {
    const scope = buildScope();
    const result = await createTrigger({ ...manual, enabled: false }, scope);
    expect(result.trigger.enabled).toBe(false);
  });

  it('rejects a second manual trigger — the manual trigger is a singleton', async () => {
    const scope = buildScope();
    await createTrigger({ ...manual, enabled: true }, scope);
    await expect(
      createTrigger(
        { ...manual, triggerName: 'manual-2', enabled: true },
        scope,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to delete a manual trigger (stop it instead)', async () => {
    const scope = buildScope();
    await createTrigger({ ...manual, enabled: true }, scope);
    await expect(deleteTrigger({ ...base, triggerName: 'manual' }, scope)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await storedTrigger('manual')).not.toBeNull();
  });

  it('rejects a manual trigger carrying a schedule', async () => {
    const scope = buildScope();
    await expect(
      createTrigger({ ...manual, schedule: '0 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a cron trigger with no schedule', async () => {
    const scope = buildScope();
    await expect(
      createTrigger({ ...cron, enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a webhook trigger, returns the derived URL, persists, and audits', async () => {
    const scope = buildScope();
    const result = await createTrigger({ ...webhook, enabled: true }, scope);

    expect(result.trigger).toMatchObject({
      type: 'webhook',
      namespace: 'team-alpha',
      workflowName: 'flow',
      name: 'hook',
      enabled: true,
      config: { method: 'POST', path: '/orders' },
    });
    expect(result.trigger.type === 'webhook' && result.trigger.lastTriggeredAt).toBeNull();
    expect(result.webhookUrl).toBe('/api/triggers/webhook/team-alpha/flow/orders');
    const stored = await storedTrigger('hook');
    expect(stored?.type === 'webhook' && stored.config.path).toBe('/orders');
    const events = auditRepo.getAll();
    expect(events[0].action).toBe('webhook.trigger.created');
  });

  it('reports webhookUrl as null for a non-webhook trigger', async () => {
    const scope = buildScope();
    const result = await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    expect(result.webhookUrl).toBeNull();
  });

  it('rejects a webhook trigger missing method or path', async () => {
    const scope = buildScope();
    await expect(
      createTrigger({ ...base, type: 'webhook', path: '/orders', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createTrigger({ ...base, type: 'webhook', method: 'POST', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a webhook trigger with a malformed path', async () => {
    const scope = buildScope();
    await expect(
      createTrigger({ ...webhook, path: 'no-leading-slash', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a webhook trigger carrying a schedule', async () => {
    const scope = buildScope();
    await expect(
      createTrigger({ ...webhook, schedule: '0 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a second webhook trigger — one webhook per workflow', async () => {
    const scope = buildScope();
    await createTrigger({ ...webhook, enabled: true }, scope);
    await expect(
      createTrigger(
        { ...webhook, triggerName: 'hook-2', path: '/other', enabled: true },
        scope,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('deletes a webhook trigger (unlike the manual singleton)', async () => {
    const scope = buildScope();
    await createTrigger({ ...webhook, enabled: true }, scope);
    const result = await deleteTrigger({ ...base, triggerName: 'hook' }, scope);
    expect(result).toEqual({ success: true });
    expect(await storedTrigger('hook')).toBeNull();
  });

  it('stops and starts a manual trigger with manual-typed audit actions', async () => {
    const scope = buildScope();
    await createTrigger({ ...manual, enabled: true }, scope);
    await setTriggerEnabled({ ...manual, enabled: false }, scope);
    await setTriggerEnabled({ ...manual, enabled: true }, scope);
    const actions = auditRepo.getAll().map((e) => e.action);
    expect(actions).toContain('manual.trigger.disabled');
    expect(actions).toContain('manual.trigger.enabled');
  });

  it('rejects creating a trigger on a non-existent workflow', async () => {
    const scope = buildScope();
    await expect(
      createTrigger(
        { ...cron, definitionName: 'ghost', schedule: '0 3 * * *', enabled: true },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects creating a trigger on a soft-deleted workflow', async () => {
    await processRepo.setWorkflowDeleted('team-alpha', 'flow', true);
    const scope = buildScope();
    await expect(
      createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a duplicate create with ConflictError', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    await expect(
      createTrigger({ ...cron, schedule: '0 4 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists a workflow’s triggers', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    const { triggers } = await listTriggers(
      { namespace: 'team-alpha', definitionName: 'flow' },
      scope,
    );
    expect(triggers.map((t) => t.name)).toEqual(['nightly']);
  });

  it('updates the schedule without touching the fire cursor', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    await triggerRepo.recordTriggered('team-alpha', 'flow', 'nightly', '2026-06-01T03:00:00.000Z');

    const result = await updateTrigger({ ...base, schedule: '0 5 * * *' }, scope);
    expect(result.trigger.type === 'cron' && result.trigger.config.schedule).toBe('0 5 * * *');
    expect(result.trigger.type === 'cron' && result.trigger.lastTriggeredAt).toBe(
      '2026-06-01T03:00:00.000Z',
    );
  });

  it('stops and starts a trigger via setEnabled with distinct audit actions', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);

    const stopped = await setTriggerEnabled({ ...base, enabled: false }, scope);
    expect(stopped.trigger.enabled).toBe(false);

    const started = await setTriggerEnabled({ ...base, enabled: true }, scope);
    expect(started.trigger.enabled).toBe(true);

    const actions = auditRepo.getAll().map((e) => e.action);
    expect(actions).toContain('cron.trigger.disabled');
    expect(actions).toContain('cron.trigger.enabled');
  });

  it('re-anchors the fire cursor on re-enable so a stopped interval never back-fires', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    // Cursor left stale in the past while the schedule is stopped.
    await triggerRepo.recordTriggered('team-alpha', 'flow', 'nightly', '2026-06-01T03:00:00.000Z');
    await setTriggerEnabled({ ...base, enabled: false }, scope);

    const before = Date.now();
    const started = await setTriggerEnabled({ ...base, enabled: true }, scope);

    const anchored = started.trigger.type === 'cron' ? started.trigger.lastTriggeredAt : null;
    expect(anchored).not.toBe('2026-06-01T03:00:00.000Z');
    expect(anchored).not.toBeNull();
    expect(new Date(anchored!).getTime()).toBeGreaterThanOrEqual(before);
    // Persisted, not only reflected in the return value.
    const stored = await storedTrigger('nightly');
    expect(stored?.type === 'cron' && stored.lastTriggeredAt).toBe(anchored);
  });

  it('does not touch the fire cursor when stopping a trigger', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    await triggerRepo.recordTriggered('team-alpha', 'flow', 'nightly', '2026-06-01T03:00:00.000Z');

    const stopped = await setTriggerEnabled({ ...base, enabled: false }, scope);
    expect(stopped.trigger.type === 'cron' && stopped.trigger.lastTriggeredAt).toBe(
      '2026-06-01T03:00:00.000Z',
    );
  });

  it('deletes a trigger', async () => {
    const scope = buildScope();
    await createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope);
    const result = await deleteTrigger(base, scope);
    expect(result).toEqual({ success: true });
    expect(await storedTrigger('nightly')).toBeNull();
  });

  it('404s updating or deleting a trigger that does not exist', async () => {
    const scope = buildScope();
    await expect(updateTrigger({ ...base, schedule: '0 5 * * *' }, scope)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(deleteTrigger(base, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides a private workflow from a non-member (404, anti-enumeration)', async () => {
    const scope = buildScope(['other-team']);
    await expect(
      createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('forbids a non-member from adding a trigger to a public workflow', async () => {
    // A public workflow is visible to non-members, so existence passes — but the
    // write gate on scope.triggers must still reject a non-member's create.
    await processRepo.setWorkflowVisibility('flow', 'team-alpha', 'public');
    const outsider = buildScope(['other-team']);
    await expect(
      createTrigger({ ...cron, schedule: '0 3 * * *', enabled: true }, outsider),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
