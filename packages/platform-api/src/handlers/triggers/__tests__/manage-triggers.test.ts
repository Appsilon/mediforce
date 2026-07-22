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

  it('rejects a non-cron type (not yet supported)', async () => {
    const scope = buildScope();
    await expect(
      createTrigger(
        { ...base, type: 'manual', schedule: '0 3 * * *', enabled: true },
        scope,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
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
