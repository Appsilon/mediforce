import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryCronTriggerStateRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { heartbeat } from '../heartbeat';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

/**
 * Handler-level tests for `heartbeat`. The cron trigger is stubbed; engine
 * mechanics (instance creation, `instance.created` emission) are covered by
 * `workflow-engine`'s cron-trigger tests. This file covers the handler-
 * resident bridge: caller gating, schedule scanning, state persistence,
 * audit emission, and run kick.
 */

describe('heartbeat handler', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let cronTriggerStateRepo: InMemoryCronTriggerStateRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    cronTriggerStateRepo = new InMemoryCronTriggerStateRepository();
  });

  it('returns empty triggered + skipped when no workflow definitions exist', async () => {
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      cronTriggerStateRepo,
    });
    Object.assign(scope.system, {
      cronTrigger: { fireWorkflow: vi.fn() },
    });

    const result = await heartbeat({}, scope);

    expect(result).toEqual({ triggered: [], skipped: [] });
  });

  it('throws ForbiddenError when caller is not a system actor', async () => {
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      cronTriggerStateRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, {
      cronTrigger: { fireWorkflow: vi.fn() },
    });

    await expect(heartbeat({}, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fires a due cron trigger, persists state, emits audit, kicks the runner', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'nightly-report',
        namespace: 'team-alpha',
        version: 1,
        triggers: [
          { type: 'cron', name: 'nightly', schedule: '*/15 * * * *' },
        ],
      }),
    );
    // ADR-0010: the heartbeat fires from Cron Trigger rows, not def.triggers.
    await cronTriggerStateRepo.create({
      namespace: 'team-alpha',
      definitionName: 'nightly-report',
      triggerName: 'nightly',
      schedule: '*/15 * * * *',
      enabled: true,
      lastTriggeredAt: null,
    });
    const fireWorkflow = vi.fn().mockResolvedValue({
      instanceId: 'inst-new-1',
      status: 'created' as const,
    });
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      cronTriggerStateRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]).toMatchObject({
      definitionName: 'nightly-report',
      definitionVersion: 1,
      triggerName: 'nightly',
      instanceId: 'inst-new-1',
    });
    expect(result.skipped).toHaveLength(0);

    expect(fireWorkflow).toHaveBeenCalledTimes(1);
    expect(fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'team-alpha',
        definitionName: 'nightly-report',
        definitionVersion: 1,
        triggerName: 'nightly',
        triggeredBy: 'cron-heartbeat',
      }),
    );

    // Fire cursor advanced AFTER successful fire.
    const persistedState = await cronTriggerStateRepo.get(
      'team-alpha',
      'nightly-report',
      'nightly',
    );
    expect(persistedState).not.toBeNull();
    expect(persistedState!.definitionName).toBe('nightly-report');
    expect(persistedState!.triggerName).toBe('nightly');
    expect(persistedState!.lastTriggeredAt).not.toBeNull();

    // Audit event recorded.
    const events = await auditRepo.getByProcess('inst-new-1');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe('cron.trigger.fired');
    expect(event.actorId).toBe('cron-heartbeat');
    expect(event.actorType).toBe('system');
    expect(event.entityType).toBe('processInstance');
    expect(event.entityId).toBe('inst-new-1');
    expect(event.processInstanceId).toBe('inst-new-1');
    expect(event.inputSnapshot).toMatchObject({
      triggerName: 'nightly',
      definitionName: 'nightly-report',
      definitionVersion: 1,
      schedule: '*/15 * * * *',
    });
    expect(event.outputSnapshot).toMatchObject({ instanceId: 'inst-new-1' });

    // Run kicked.
    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-new-1', triggeredBy: 'cron-heartbeat' },
    ]);
  });

  it('skips a not-due trigger — no audit, no kick, reason="Not due"', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'quarter-hourly',
        namespace: 'team-alpha',
        version: 1,
        triggers: [
          { type: 'cron', name: 'beat', schedule: '0 0 1 1 0' }, // Jan 1 midnight Sunday — rarely matches
        ],
      }),
    );
    // Seed a row with the rare schedule + a recent cursor so isDue's scan path
    // is taken and yields "Not due".
    await cronTriggerStateRepo.create({
      namespace: 'team-alpha',
      definitionName: 'quarter-hourly',
      triggerName: 'beat',
      schedule: '0 0 1 1 0',
      enabled: true,
      lastTriggeredAt: new Date().toISOString(),
    });

    const fireWorkflow = vi.fn();
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      cronTriggerStateRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      definitionName: 'quarter-hourly',
      triggerName: 'beat',
      reason: 'Not due',
    });
    expect(fireWorkflow).not.toHaveBeenCalled();
    expect(kicker.kicks).toHaveLength(0);
  });

  it('skips a Cron Trigger whose workflow was deleted — no ghost fire', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'gone',
        namespace: 'team-alpha',
        version: 1,
        triggers: [{ type: 'cron', name: 'nightly', schedule: '*/15 * * * *' }],
      }),
    );
    await processRepo.setWorkflowDeleted('team-alpha', 'gone', true);
    await cronTriggerStateRepo.create({
      namespace: 'team-alpha',
      definitionName: 'gone',
      triggerName: 'nightly',
      schedule: '*/15 * * * *',
      enabled: true,
      lastTriggeredAt: null,
    });

    const fireWorkflow = vi.fn();
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      cronTriggerStateRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      definitionName: 'gone',
      triggerName: 'nightly',
      reason: 'Workflow deleted',
    });
    expect(fireWorkflow).not.toHaveBeenCalled();
  });
});
