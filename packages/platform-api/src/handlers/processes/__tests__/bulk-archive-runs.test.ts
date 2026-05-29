import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { bulkArchiveRuns } from '../bulk-archive-runs';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('bulkArchiveRuns handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  it('archives each eligible run and reports errors for active runs', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'a', namespace: 'team-alpha', status: 'completed' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'b', namespace: 'team-alpha', status: 'running' }),
    );
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { results } = await bulkArchiveRuns({ runIds: ['a', 'b'] }, scope);

    expect(results[0]).toEqual({ id: 'a', status: 'ok' });
    expect(results[1]).toMatchObject({ id: 'b', status: 'error' });

    const eventsA = await auditRepo.getByProcess('a');
    expect(eventsA.map((e) => e.action)).toEqual(['instance.archived']);
  });
});
