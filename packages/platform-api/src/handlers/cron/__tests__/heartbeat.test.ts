import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryCronTriggerStateRepository,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { heartbeat, type CronScheduleValidator, type CronTriggerLike } from '../heartbeat.js';

function makeValidator(isDueReturn: boolean): CronScheduleValidator {
  return {
    validateCronSchedule: () => ({ valid: true }),
    isDue: () => isDueReturn,
  };
}

function makeDef(overrides: Partial<{ cron: boolean; schedule?: string }> = {}) {
  const { cron = true, schedule = '*/5 * * * *' } = overrides;
  return {
    name: 'wf-a',
    version: 1,
    namespace: 'handle',
    steps: [{ id: 'a', name: 'A', type: 'creation' as const }],
    transitions: [],
    variables: [],
    triggers: cron
      ? [{ name: 'every-5', type: 'cron' as const, schedule }]
      : [{ name: 'manual', type: 'manual' as const }],
    permissions: { roles: [] },
    metadata: { description: '' },
    createdAt: '2026-04-01T00:00:00.000Z',
  };
}

describe('heartbeat handler', () => {
  let processRepo: InMemoryProcessRepository;
  let cronTriggerStateRepo: InMemoryCronTriggerStateRepository;
  let cronTrigger: CronTriggerLike & { fireWorkflow: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    cronTriggerStateRepo = new InMemoryCronTriggerStateRepository();
    cronTrigger = {
      fireWorkflow: vi.fn().mockResolvedValue({
        instanceId: 'inst-new',
        status: 'created',
      }),
    };
  });

  it('fires a due cron trigger and returns the triggered entry', async () => {
    await processRepo.saveWorkflowDefinition(makeDef() as never);

    const result = await heartbeat(
      {},
      {
        processRepo,
        cronTrigger,
        cronTriggerStateRepo,
        scheduleValidator: makeValidator(true),
      },
    );

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]?.instanceId).toBe('inst-new');
    expect(cronTrigger.fireWorkflow).toHaveBeenCalledTimes(1);
  });

  it('persists trigger state after a successful fire', async () => {
    await processRepo.saveWorkflowDefinition(makeDef() as never);

    await heartbeat(
      {},
      {
        processRepo,
        cronTrigger,
        cronTriggerStateRepo,
        scheduleValidator: makeValidator(true),
      },
    );

    const state = await cronTriggerStateRepo.get('wf-a', 'every-5');
    expect(state).not.toBeNull();
  });

  it('skips when the schedule is not due', async () => {
    await processRepo.saveWorkflowDefinition(makeDef() as never);

    const result = await heartbeat(
      {},
      {
        processRepo,
        cronTrigger,
        cronTriggerStateRepo,
        scheduleValidator: makeValidator(false),
      },
    );

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('Not due');
  });

  it('skips when schedule is invalid', async () => {
    await processRepo.saveWorkflowDefinition(makeDef() as never);

    const result = await heartbeat(
      {},
      {
        processRepo,
        cronTrigger,
        cronTriggerStateRepo,
        scheduleValidator: {
          validateCronSchedule: () => ({ valid: false, error: 'bad cron' }),
          isDue: () => true,
        },
      },
    );

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('Invalid schedule');
  });

  it('calls triggerRun when provided', async () => {
    await processRepo.saveWorkflowDefinition(makeDef() as never);
    const triggerRun = vi.fn();

    await heartbeat(
      {},
      {
        processRepo,
        cronTrigger,
        cronTriggerStateRepo,
        scheduleValidator: makeValidator(true),
        triggerRun,
      },
    );

    expect(triggerRun).toHaveBeenCalledWith('inst-new', 'cron-heartbeat');
  });

  it('ignores definitions without cron triggers', async () => {
    await processRepo.saveWorkflowDefinition(makeDef({ cron: false }) as never);

    const result = await heartbeat(
      {},
      {
        processRepo,
        cronTrigger,
        cronTriggerStateRepo,
        scheduleValidator: makeValidator(true),
      },
    );

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});
