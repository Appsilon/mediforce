import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { settleRunWaits } from '../settle-run-waits';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

const JOIN_WAIT = {
  stepId: 'join',
  resumeAt: '2999-01-01T00:00:00.000Z',
  pausedAt: '2026-06-01T10:00:00.000Z',
  mode: 'deadline',
  condition: 'children.allFinished == true',
};

describe('settleRunWaits', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let kicker: ReturnType<typeof noopRunKicker>;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    kicker = noopRunKicker();
  });

  function scope() {
    return createTestScope({
      instanceRepo,
      auditRepo: new InMemoryAuditRepository(instanceRepo),
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
  }

  async function seedParent(overrides: { pauseReason?: 'waiting_for_timer' | 'waiting_for_human' } = {}) {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'parent',
        namespace: 'team-alpha',
        status: 'paused',
        pauseReason: overrides.pauseReason ?? 'waiting_for_timer',
        variables: { __wait: JOIN_WAIT },
      }),
    );
  }

  async function seedChild(id: string, status: 'running' | 'completed' | 'failed') {
    await instanceRepo.create(
      buildProcessInstance({ id, namespace: 'team-alpha', status, parentInstanceId: 'parent' }),
    );
  }

  it('resumes the parent when its last child ends', async () => {
    await seedParent();
    await seedChild('child-1', 'completed');
    await seedChild('child-2', 'failed');

    await settleRunWaits('child-2', scope());

    expect((await instanceRepo.getById('parent'))?.status).toBe('running');
    expect(kicker.kicks).toHaveLength(1);
  });

  it('leaves the parent waiting while another child is still running', async () => {
    await seedParent();
    await seedChild('child-1', 'completed');
    await seedChild('child-2', 'running');

    await settleRunWaits('child-1', scope());

    expect((await instanceRepo.getById('parent'))?.status).toBe('paused');
    expect(kicker.kicks).toHaveLength(0);
  });

  it('resumes a run that parked on its join after all its children had already ended', async () => {
    await seedParent();
    await seedChild('child-1', 'completed');

    await settleRunWaits('parent', scope());

    expect((await instanceRepo.getById('parent'))?.status).toBe('running');
    expect(kicker.kicks).toHaveLength(1);
  });

  it('ignores a parent that is paused for something other than a wait', async () => {
    await seedParent({ pauseReason: 'waiting_for_human' });
    await seedChild('child-1', 'completed');

    await settleRunWaits('child-1', scope());

    expect((await instanceRepo.getById('parent'))?.status).toBe('paused');
    expect(kicker.kicks).toHaveLength(0);
  });

  it('does nothing for a run that has no parent or does not exist', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'solo', namespace: 'team-alpha', status: 'completed' }));

    await settleRunWaits('solo', scope());
    await settleRunWaits('missing', scope());

    expect(kicker.kicks).toHaveLength(0);
  });
});
