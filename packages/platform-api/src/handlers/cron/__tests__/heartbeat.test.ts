import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryCronTriggerStateRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { heartbeat } from '../heartbeat.js';
import { ForbiddenError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { noopRunKicker } from '../../../runtime/run-kicker.js';

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

    // State persisted AFTER successful fire.
    const persistedState = await cronTriggerStateRepo.get(
      'nightly-report',
      'nightly',
    );
    expect(persistedState).not.toBeNull();
    expect(persistedState!.definitionName).toBe('nightly-report');
    expect(persistedState!.triggerName).toBe('nightly');

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
    // Seed state so isDue's scan path is taken with a recent lastTriggeredAt.
    await cronTriggerStateRepo.set({
      definitionName: 'quarter-hourly',
      triggerName: 'beat',
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
});
