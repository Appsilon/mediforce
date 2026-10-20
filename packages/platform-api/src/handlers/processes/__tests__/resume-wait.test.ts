import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { resumeWait } from '../resume-wait';
import { PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

describe('resumeWait handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  it('resumes when timer has expired', async () => {
    const pausedAt = '2026-06-01T10:00:00.000Z';
    const resumeAt = '2026-06-01T12:00:00.000Z';

    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-waiting',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'waiting_for_timer',
        variables: {
          __wait: { stepId: 'wait-step', resumeAt, pausedAt, mode: 'duration' },
        },
      }),
    );

    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });


    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T13:00:00.000Z'));

    const result = await resumeWait({ runId: 'inst-waiting' }, scope);

    expect(result.resumed).toBe(true);
    expect(result.resumeReason).toBe('duration_elapsed');

    const updated = await instanceRepo.getById('inst-waiting');
    expect(updated!.status).toBe('running');
    expect(updated!.pauseReason).toBeNull();
    expect((updated!.variables as Record<string, unknown>).__wait).toBeUndefined();
    expect((updated!.variables as Record<string, unknown>)['wait-step']).toMatchObject({
      resumeReason: 'duration_elapsed',
    });

    expect(kicker.kicks).toHaveLength(1);

    vi.useRealTimers();
  });

  it('returns not-ready when timer has not expired', async () => {
    const resumeAt = '2026-06-02T00:00:00.000Z';

    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-waiting',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'waiting_for_timer',
        variables: {
          __wait: { stepId: 'wait-step', resumeAt, pausedAt: '2026-06-01T10:00:00.000Z', mode: 'duration' },
        },
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });


    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T15:00:00.000Z'));

    const result = await resumeWait({ runId: 'inst-waiting' }, scope);

    expect(result.resumed).toBe(false);
    expect(result.resumeAt).toBe(resumeAt);

    const updated = await instanceRepo.getById('inst-waiting');
    expect(updated!.status).toBe('paused');

    vi.useRealTimers();
  });

  it('resumes with deadline_reached for deadline-mode waits', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-deadline',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'waiting_for_timer',
        variables: {
          __wait: {
            stepId: 'wait-step',
            resumeAt: '2026-06-01T12:00:00.000Z',
            pausedAt: '2026-06-01T10:00:00.000Z',
            mode: 'deadline',
          },
        },
      }),
    );

    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });


    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T13:00:00.000Z'));

    const result = await resumeWait({ runId: 'inst-deadline' }, scope);

    expect(result.resumed).toBe(true);
    expect(result.resumeReason).toBe('deadline_reached');

    vi.useRealTimers();
  });

  it('resumes early when condition is met before resumeAt', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-condition',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'waiting_for_timer',
        variables: {
          __wait: {
            stepId: 'wait-step',
            resumeAt: '2026-06-02T00:00:00.000Z',
            pausedAt: '2026-06-01T10:00:00.000Z',
            mode: 'deadline',
            condition: 'variables.allDone == true',
          },
          allDone: true,
        },
      }),
    );

    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });


    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

    const result = await resumeWait({ runId: 'inst-condition' }, scope);

    expect(result.resumed).toBe(true);
    expect(result.resumeReason).toBe('condition_met');

    const updated = await instanceRepo.getById('inst-condition');
    expect(updated!.status).toBe('running');
    expect((updated!.variables as Record<string, unknown>)['wait-step']).toMatchObject({
      resumeReason: 'condition_met',
    });

    vi.useRealTimers();
  });

  describe('children.* condition (spawn + wait join)', () => {
    const JOIN_CONDITION = 'children.allCompleted == true';

    async function seedParentWaitingOnChildren(childStatuses: Array<'running' | 'paused' | 'completed' | 'failed'>) {
      await instanceRepo.create(
        buildProcessInstance({
          id: 'inst-parent',
          namespace: 'team-alpha',
          status: 'paused',
          pauseReason: 'waiting_for_timer',
          variables: {
            __wait: {
              stepId: 'wait-step',
              resumeAt: '2026-06-02T00:00:00.000Z',
              pausedAt: '2026-06-01T10:00:00.000Z',
              mode: 'deadline',
              condition: JOIN_CONDITION,
            },
          },
        }),
      );
      for (const [index, status] of childStatuses.entries()) {
        await instanceRepo.create(
          buildProcessInstance({
            id: `inst-child-${index}`,
            namespace: 'team-alpha',
            status,
            parentInstanceId: 'inst-parent',
          }),
        );
      }
    }

    function scopeFor() {
      return createTestScope({
        instanceRepo,
        auditRepo,
        runKicker: noopRunKicker(),
        caller: userCaller('u-1', ['team-alpha']),
      });
    }

    it('resumes early once every child has finished, failed ones included', async () => {
      await seedParentWaitingOnChildren(['completed', 'failed']);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

      const result = await resumeWait({ runId: 'inst-parent' }, scopeFor());

      expect(result).toEqual({ resumed: true, resumeReason: 'condition_met' });
      vi.useRealTimers();
    });

    it('keeps waiting while a child is still running', async () => {
      await seedParentWaitingOnChildren(['completed', 'running']);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

      const result = await resumeWait({ runId: 'inst-parent' }, scopeFor());

      expect(result.resumed).toBe(false);
      vi.useRealTimers();
    });

    it('resumes on the deadline with children still running', async () => {
      await seedParentWaitingOnChildren(['completed', 'paused']);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-02T01:00:00.000Z'));

      const result = await resumeWait({ runId: 'inst-parent' }, scopeFor());

      expect(result).toEqual({ resumed: true, resumeReason: 'deadline_reached' });
      vi.useRealTimers();
    });

    it('resumes at once when nothing was spawned', async () => {
      await seedParentWaitingOnChildren([]);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

      const result = await resumeWait({ runId: 'inst-parent' }, scopeFor());

      expect(result).toEqual({ resumed: true, resumeReason: 'condition_met' });
      vi.useRealTimers();
    });

    it('exposes the counts to the condition', async () => {
      await seedParentWaitingOnChildren(['completed', 'completed', 'failed', 'running']);
      const parent = await instanceRepo.getById('inst-parent');
      const waitMeta = (parent!.variables as Record<string, Record<string, unknown>>).__wait;
      await instanceRepo.update('inst-parent', {
        variables: {
          __wait: {
            ...waitMeta,
            condition: 'children.totalCount == 4 && children.completedCount == 2 && children.failedCount == 1',
          },
        },
      });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

      const result = await resumeWait({ runId: 'inst-parent' }, scopeFor());

      expect(result).toEqual({ resumed: true, resumeReason: 'condition_met' });
      vi.useRealTimers();
    });
  });

  it('throws PreconditionFailedError for non-waiting instance', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-running',
        namespace: 'team-alpha',
        status: 'running',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });


    await expect(
      resumeWait({ runId: 'inst-running' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('throws PreconditionFailedError when paused but wrong reason', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-human',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: 'waiting_for_human',
      }),
    );

    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });


    await expect(
      resumeWait({ runId: 'inst-human' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});
