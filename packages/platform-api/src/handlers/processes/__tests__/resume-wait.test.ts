import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { resumeWait } from '../resume-wait.js';
import { PreconditionFailedError } from '../../../errors.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { noopRunKicker } from '../../../runtime/run-kicker.js';
import type { CallerScope } from '../../../repositories/caller-scope.js';

function scopeWithEngine(base: CallerScope): CallerScope {
  return {
    ...base,
    system: {
      ...base.system,
      engine: {
        advanceStep: vi.fn().mockResolvedValue({}),
      } as unknown as CallerScope['system']['engine'],
    },
  };
}

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
          __wait: { stepId: 'wait-step', resumeAt, pausedAt },
        },
      }),
    );

    const kicker = noopRunKicker();
    const baseScope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const scope = scopeWithEngine(baseScope);

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
          __wait: { stepId: 'wait-step', resumeAt, pausedAt: '2026-06-01T10:00:00.000Z' },
        },
      }),
    );

    const baseScope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const scope = scopeWithEngine(baseScope);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T15:00:00.000Z'));

    const result = await resumeWait({ runId: 'inst-waiting' }, scope);

    expect(result.resumed).toBe(false);
    expect(result.resumeAt).toBe(resumeAt);

    const updated = await instanceRepo.getById('inst-waiting');
    expect(updated!.status).toBe('paused');

    vi.useRealTimers();
  });

  it('throws PreconditionFailedError for non-waiting instance', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-running',
        namespace: 'team-alpha',
        status: 'running',
      }),
    );

    const baseScope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const scope = scopeWithEngine(baseScope);

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

    const baseScope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    const scope = scopeWithEngine(baseScope);

    await expect(
      resumeWait({ runId: 'inst-human' }, scope),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });
});
