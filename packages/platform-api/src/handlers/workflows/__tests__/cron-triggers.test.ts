import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryCronTriggerStateRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import {
  listCronTriggers,
  createCronTrigger,
  updateCronTrigger,
  setCronTriggerEnabled,
  deleteCronTrigger,
} from '../cron-triggers';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../errors';

describe('cron trigger handlers (ADR-0010)', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;
  let cronTriggerStateRepo: InMemoryCronTriggerStateRepository;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    cronTriggerStateRepo = new InMemoryCronTriggerStateRepository();
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow', version: 1, namespace: 'team-alpha' }),
    );
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      auditRepo,
      cronTriggerStateRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  const base = { namespace: 'team-alpha', definitionName: 'flow', triggerName: 'nightly' };

  it('creates a cron trigger, persists it, and audits', async () => {
    const scope = buildScope();
    const result = await createCronTrigger(
      { ...base, schedule: '0 3 * * *', enabled: true },
      scope,
    );

    expect(result.trigger).toMatchObject({ ...base, schedule: '0 3 * * *', enabled: true });
    // Cursor anchored to creation time so the schedule starts at its next slot.
    expect(result.trigger.lastTriggeredAt).not.toBeNull();
    const stored = await cronTriggerStateRepo.get('team-alpha', 'flow', 'nightly');
    expect(stored?.schedule).toBe('0 3 * * *');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('cron.trigger.created');
    expect(events[0].actorId).toBe('user-42');
  });

  it('rejects an invalid (non-15-min-aligned) schedule', async () => {
    const scope = buildScope();
    await expect(
      createCronTrigger({ ...base, schedule: '5 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects creating a trigger on a non-existent workflow', async () => {
    const scope = buildScope();
    await expect(
      createCronTrigger(
        { ...base, definitionName: 'ghost', schedule: '0 3 * * *', enabled: true },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects creating a trigger on a soft-deleted workflow', async () => {
    await processRepo.setWorkflowDeleted('team-alpha', 'flow', true);
    const scope = buildScope();
    await expect(
      createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a duplicate create with ConflictError', async () => {
    const scope = buildScope();
    await createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope);
    await expect(
      createCronTrigger({ ...base, schedule: '0 4 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists a workflow’s cron triggers', async () => {
    const scope = buildScope();
    await createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope);
    const { triggers } = await listCronTriggers(
      { namespace: 'team-alpha', definitionName: 'flow' },
      scope,
    );
    expect(triggers.map((t) => t.triggerName)).toEqual(['nightly']);
  });

  it('updates the schedule without touching the fire cursor', async () => {
    const scope = buildScope();
    await createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope);
    await cronTriggerStateRepo.recordTriggered('team-alpha', 'flow', 'nightly', '2026-06-01T03:00:00.000Z');

    const result = await updateCronTrigger({ ...base, schedule: '0 5 * * *' }, scope);
    expect(result.trigger.schedule).toBe('0 5 * * *');
    expect(result.trigger.lastTriggeredAt).toBe('2026-06-01T03:00:00.000Z');
  });

  it('stops and starts a trigger via setEnabled with distinct audit actions', async () => {
    const scope = buildScope();
    await createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope);

    const stopped = await setCronTriggerEnabled({ ...base, enabled: false }, scope);
    expect(stopped.trigger.enabled).toBe(false);

    const started = await setCronTriggerEnabled({ ...base, enabled: true }, scope);
    expect(started.trigger.enabled).toBe(true);

    const actions = auditRepo.getAll().map((e) => e.action);
    expect(actions).toContain('cron.trigger.disabled');
    expect(actions).toContain('cron.trigger.enabled');
  });

  it('deletes a trigger', async () => {
    const scope = buildScope();
    await createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope);
    const result = await deleteCronTrigger(base, scope);
    expect(result).toEqual({ success: true });
    expect(await cronTriggerStateRepo.get('team-alpha', 'flow', 'nightly')).toBeNull();
  });

  it('hides a private workflow from a non-member (404, anti-enumeration)', async () => {
    const scope = buildScope(['other-team']);
    await expect(
      createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('forbids a non-member from adding a trigger to a public workflow', async () => {
    // A public workflow is visible to non-members, so existence passes — but the
    // write gate on scope.cron must still reject a non-member's create.
    await processRepo.setWorkflowVisibility('flow', 'team-alpha', 'public');
    const outsider = buildScope(['other-team']);
    await expect(
      createCronTrigger({ ...base, schedule: '0 3 * * *', enabled: true }, outsider),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
