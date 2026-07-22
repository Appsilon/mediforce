import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
  buildProcessInstance,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { heartbeat, STRANDED_RUNNING_THRESHOLD_MS } from '../heartbeat';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

/**
 * Handler-level tests for `heartbeat`. Row-driven (ADR-0011): enabled cron
 * rows in the unified `triggers` table are the source of truth for what fires,
 * resolved against the target workflow's default→latest version. The cron
 * trigger service is stubbed; engine mechanics are covered elsewhere. This file
 * covers the handler bridge: caller gating, resolve-and-skip, fire-cursor
 * advance, audit emission, run kick, and the paused/stranded sweeps.
 */

describe('heartbeat handler', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let triggerRepo: InMemoryTriggerRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    triggerRepo = new InMemoryTriggerRepository();
  });

  function seedCron(opts: {
    namespace: string;
    workflowName: string;
    name: string;
    schedule: string;
    enabled?: boolean;
    lastTriggeredAt?: string | null;
  }): Promise<unknown> {
    const now = new Date().toISOString();
    return triggerRepo.create({
      type: 'cron',
      namespace: opts.namespace,
      workflowName: opts.workflowName,
      name: opts.name,
      enabled: opts.enabled ?? true,
      config: { schedule: opts.schedule },
      lastTriggeredAt: opts.lastTriggeredAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  it('returns empty triggered + skipped when no cron rows exist', async () => {
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    const result = await heartbeat({}, scope);

    expect(result).toEqual({ triggered: [], skipped: [] });
  });

  it('throws ForbiddenError when caller is not a system actor', async () => {
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await expect(heartbeat({}, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fires a due cron trigger, advances the cursor, emits audit, kicks the runner', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'nightly-report', namespace: 'team-alpha', version: 1 }),
    );
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'nightly-report',
      name: 'nightly',
      schedule: '*/15 * * * *',
      lastTriggeredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
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
      triggerRepo,
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
    const rows = await triggerRepo.listByWorkflow('team-alpha', 'nightly-report');
    const row = rows.find((r) => r.name === 'nightly');
    expect(row?.type === 'cron' && row.lastTriggeredAt).not.toBeNull();
    expect(
      row?.type === 'cron' &&
        new Date(row.lastTriggeredAt!).getTime() > Date.now() - 5000,
    ).toBe(true);

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
    expect(kicker.kicks).toEqual([{ instanceId: 'inst-new-1', triggeredBy: 'cron-heartbeat' }]);
  });

  it('resolves against the default version when set (not latest)', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'versioned', namespace: 'team-alpha', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'versioned', namespace: 'team-alpha', version: 2 }),
    );
    await processRepo.setDefaultWorkflowVersion('team-alpha', 'versioned', 1);
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'versioned',
      name: 'beat',
      schedule: '*/15 * * * *',
      lastTriggeredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const fireWorkflow = vi.fn().mockResolvedValue({ instanceId: 'i', status: 'created' as const });
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    await heartbeat({}, scope);

    expect(fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ definitionName: 'versioned', definitionVersion: 1 }),
    );
  });

  it('skips a cron row whose target workflow is soft-deleted (resolve-and-skip)', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'gone', namespace: 'team-alpha', version: 1 }),
    );
    await processRepo.setWorkflowDeleted('team-alpha', 'gone', true);
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'gone',
      name: 'beat',
      schedule: '*/15 * * * *',
    });
    const fireWorkflow = vi.fn();
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(fireWorkflow).not.toHaveBeenCalled();
    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ triggerName: 'beat', reason: 'Workflow deleted' });
  });

  it('skips a cron row that points at an unresolvable workflow', async () => {
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'never-registered',
      name: 'beat',
      schedule: '*/15 * * * *',
    });
    const fireWorkflow = vi.fn();
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(fireWorkflow).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ reason: 'No resolvable version' });
  });

  it('re-kicks a running instance stranded past the threshold (driver died mid-step)', async () => {
    // status=running, but not updated for 2h — its auto-runner request died
    // mid-step. The paused sweeps can never see it; without the stranded sweep
    // it sits at its current step forever.
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-stranded',
        namespace: 'team-alpha',
        status: 'running',
        currentStepId: 'arm-timer',
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await heartbeat({}, scope);

    expect(kicker.kicks).toContainEqual(
      expect.objectContaining({ instanceId: 'inst-stranded' }),
    );
    const events = await auditRepo.getByProcess('inst-stranded');
    expect(events.map((e) => e.action)).toContain('instance.stranded_rekicked');
  });

  it('honors a step\'s configured timeout: no re-kick while within the custom budget', async () => {
    // A step configured with a 90-minute timeout, idle 60m — over the 45m
    // default bound but well within its own budget (90m + grace). A fixed bound
    // would have mistaken this live run for stranded.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'slow-wf',
        namespace: 'team-alpha',
        version: 1,
        steps: [
          {
            id: 'slow-step',
            name: 'Slow step',
            type: 'creation',
            executor: 'agent',
            autonomyLevel: 'L4',
            agent: { timeoutMinutes: 90 },
          },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'slow-step', to: 'done' }],
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-slow',
        namespace: 'team-alpha',
        definitionName: 'slow-wf',
        definitionVersion: '1',
        status: 'running',
        currentStepId: 'slow-step',
        updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await heartbeat({}, scope);

    expect(kicker.kicks).toHaveLength(0);
  });

  it('re-kicks a running instance past its step\'s configured timeout + grace', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'slow-wf',
        namespace: 'team-alpha',
        version: 1,
        steps: [
          {
            id: 'slow-step',
            name: 'Slow step',
            type: 'creation',
            executor: 'agent',
            autonomyLevel: 'L4',
            agent: { timeoutMinutes: 90 },
          },
          { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'slow-step', to: 'done' }],
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-slow-dead',
        namespace: 'team-alpha',
        definitionName: 'slow-wf',
        definitionVersion: '1',
        status: 'running',
        currentStepId: 'slow-step',
        // 120m idle > 90m timeout + 15m grace.
        updatedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await heartbeat({}, scope);

    expect(kicker.kicks).toContainEqual(
      expect.objectContaining({ instanceId: 'inst-slow-dead' }),
    );
  });

  it('does not re-kick a running instance just under the stranded threshold', async () => {
    // Boundary guard: one minute short of the threshold must not be swept.
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-just-under',
        namespace: 'team-alpha',
        status: 'running',
        currentStepId: 'implement',
        updatedAt: new Date(
          Date.now() - (STRANDED_RUNNING_THRESHOLD_MS - 60 * 1000),
        ).toISOString(),
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await heartbeat({}, scope);

    expect(kicker.kicks).toHaveLength(0);
  });

  it('does not re-kick a running instance updated recently (step legitimately in progress)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-fresh',
        namespace: 'team-alpha',
        status: 'running',
        currentStepId: 'implement',
        updatedAt: new Date().toISOString(),
      }),
    );
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
      runKicker: kicker,
    });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await heartbeat({}, scope);

    expect(kicker.kicks).toHaveLength(0);
    const events = await auditRepo.getByProcess('inst-fresh');
    expect(events.map((e) => e.action)).not.toContain('instance.stranded_rekicked');
  });

  it('skips a not-due trigger — no audit, no kick, reason="Not due"', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'quarter-hourly', namespace: 'team-alpha', version: 1 }),
    );
    // Seed cron row with a recent cursor so isDue's scan path finds no slot.
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'quarter-hourly',
      name: 'beat',
      schedule: '0 0 1 1 0', // Jan 1 midnight Sunday — rarely matches
      lastTriggeredAt: new Date().toISOString(),
    });

    const fireWorkflow = vi.fn();
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      triggerRepo,
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
