import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
  buildProcessInstance,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { syncRegistryIfStale } from '@mediforce/platform-infra';
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
 * advance, audit emission, run kick, the paused/stranded sweeps, and the
 * model-registry sweep (whose staleness and failure semantics belong to
 * `syncRegistryIfStale`, mocked here).
 */

vi.mock('@mediforce/platform-infra', () => ({
  syncRegistryIfStale: vi.fn(async () => ({ ran: false })),
}));

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

  afterEach(() => {
    vi.mocked(syncRegistryIfStale).mockClear();
  });

  function seedCron(opts: {
    namespace: string;
    workflowName: string;
    name: string;
    schedule: string;
    enabled?: boolean;
    lastTriggeredAt?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<unknown> {
    const now = new Date().toISOString();
    return triggerRepo.create({
      type: 'cron',
      namespace: opts.namespace,
      workflowName: opts.workflowName,
      name: opts.name,
      enabled: opts.enabled ?? true,
      config: {
        schedule: opts.schedule,
        ...(opts.payload === undefined ? {} : { payload: opts.payload }),
      },
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
        // ADR-0012: the row's static input is the payload; the tick's own
        // schedule/firedAt are transport and ride on `context` instead, so a
        // step never reads `${triggerPayload.schedule}`.
        payload: {},
        context: expect.objectContaining({ schedule: '*/15 * * * *' }),
      }),
    );
    expect(fireWorkflow.mock.calls[0]![0].payload).not.toHaveProperty('schedule');
    expect(fireWorkflow.mock.calls[0]![0].payload).not.toHaveProperty('firedAt');

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

  it('fires each cron row with its own static payload', async () => {
    // Two schedules on one workflow are only distinguishable by their payload —
    // this is the reason it lives on the mutable row and not the definition.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'regional-report',
        namespace: 'team-alpha',
        version: 1,
        triggerInput: [{ name: 'region', type: 'string', required: true }],
      }),
    );
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'regional-report',
      name: 'nightly-us',
      schedule: '*/15 * * * *',
      lastTriggeredAt: anHourAgo,
      payload: { region: 'us' },
    });
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'regional-report',
      name: 'nightly-eu',
      schedule: '*/15 * * * *',
      lastTriggeredAt: anHourAgo,
      payload: { region: 'eu' },
    });

    const fireWorkflow = vi
      .fn()
      .mockResolvedValue({ instanceId: 'i', status: 'created' as const });
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(result.triggered).toHaveLength(2);
    const firedPayloads = fireWorkflow.mock.calls.map((c) => c[0].payload);
    expect(firedPayloads).toEqual(
      expect.arrayContaining([{ region: 'us' }, { region: 'eu' }]),
    );
  });

  it('skips with a reason when a later version moved the contract under the row', async () => {
    // Attach-time validation passed against v1; v2 adds a required field the
    // static payload cannot satisfy. That is drift, not a caller error — it
    // skips the tick with an audit reason rather than erroring (ADR-0012).
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'drifted',
        namespace: 'team-alpha',
        version: 1,
        triggerInput: [{ name: 'region', type: 'string', required: true }],
      }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'drifted',
        namespace: 'team-alpha',
        version: 2,
        triggerInput: [
          { name: 'region', type: 'string', required: true },
          { name: 'studyId', type: 'string', required: true },
        ],
      }),
    );
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'drifted',
      name: 'nightly',
      schedule: '*/15 * * * *',
      lastTriggeredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      payload: { region: 'us' },
    });

    const fireWorkflow = vi.fn();
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(fireWorkflow).not.toHaveBeenCalled();
    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('studyId');
    expect(result.skipped[0]!.reason).toContain('triggerInput');
  });

  it('skips a payload-less row whose workflow requires input', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'needs-input',
        namespace: 'team-alpha',
        version: 1,
        triggerInput: [{ name: 'region', type: 'string', required: true }],
      }),
    );
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'needs-input',
      name: 'nightly',
      schedule: '*/15 * * * *',
      lastTriggeredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const fireWorkflow = vi.fn();
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(fireWorkflow).not.toHaveBeenCalled();
    expect(result.skipped[0]!.reason).toContain('region');
  });

  it('fires a row with the contract default for a field its static payload omits', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'regional-report',
        namespace: 'team-alpha',
        version: 1,
        triggerInput: [
          { name: 'region', type: 'string', required: true },
          { name: 'format', type: 'string', required: false, default: 'pdf' },
        ],
      }),
    );
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'regional-report',
      name: 'nightly-us',
      schedule: '*/15 * * * *',
      lastTriggeredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      payload: { region: 'us' },
    });
    const fireWorkflow = vi
      .fn()
      .mockResolvedValue({ instanceId: 'i', status: 'created' as const });
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(result.triggered).toHaveLength(1);
    expect(fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { region: 'us', format: 'pdf' } }),
    );
  });

  it('fires a payload-less row whose required field carries a default', async () => {
    // A cron row can carry no static input at all, so a required field with a
    // default used to make the workflow un-fireable from cron: the default was
    // read only by the Start Run form, and the row skipped every tick.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'defaulted-input',
        namespace: 'team-alpha',
        version: 1,
        triggerInput: [
          { name: 'region', type: 'string', required: true, default: 'global' },
        ],
      }),
    );
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'defaulted-input',
      name: 'nightly',
      schedule: '*/15 * * * *',
      lastTriggeredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const fireWorkflow = vi
      .fn()
      .mockResolvedValue({ instanceId: 'i', status: 'created' as const });
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(result.skipped).toHaveLength(0);
    expect(result.triggered).toHaveLength(1);
    expect(fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { region: 'global' } }),
    );
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

  it('falls back to the newest live version when the default is archived', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'versioned', namespace: 'team-alpha', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'versioned', namespace: 'team-alpha', version: 2 }),
    );
    // Default points at v2, but v2 is archived — v1 is still runnable.
    await processRepo.setDefaultWorkflowVersion('team-alpha', 'versioned', 2);
    await processRepo.setVersionArchived('team-alpha', 'versioned', 2, true);
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

    const result = await heartbeat({}, scope);

    expect(result.skipped).toHaveLength(0);
    expect(fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ definitionName: 'versioned', definitionVersion: 1 }),
    );
  });

  it('skips a cron row when every version of the target workflow is archived', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'shelved', namespace: 'team-alpha', version: 1 }),
    );
    await processRepo.setVersionArchived('team-alpha', 'shelved', 1, true);
    await seedCron({
      namespace: 'team-alpha',
      workflowName: 'shelved',
      name: 'beat',
      schedule: '*/15 * * * *',
    });
    const fireWorkflow = vi.fn();
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow } });

    const result = await heartbeat({}, scope);

    expect(fireWorkflow).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ triggerName: 'beat', reason: 'No live version' });
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

  it('sweeps the model registry so a long-lived deployment refreshes itself', async () => {
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await heartbeat({}, scope);

    expect(syncRegistryIfStale).toHaveBeenCalledWith(scope.models, { auditRepo });
  });

  it('completes the beat when the registry sweep fails', async () => {
    vi.mocked(syncRegistryIfStale).mockRejectedValueOnce(new Error('OpenRouter down'));
    const scope = createTestScope({ processRepo, instanceRepo, auditRepo, triggerRepo });
    Object.assign(scope.system, { cronTrigger: { fireWorkflow: vi.fn() } });

    await expect(heartbeat({}, scope)).resolves.toEqual({ triggered: [], skipped: [] });
  });
});
