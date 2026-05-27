import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { bulkCancelRuns } from '../bulk-cancel-runs.js';
import { bulkArchiveRuns } from '../bulk-archive-runs.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('bulkCancelRuns handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  it('returns per-id results in ADR-0005 shape', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'a', namespace: 'team-alpha', status: 'running' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'b', namespace: 'team-alpha', status: 'completed' }),
    );
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { results } = await bulkCancelRuns({ runIds: ['a', 'b', 'missing'] }, scope);

    expect(results).toEqual([
      { id: 'a', status: 'ok' },
      expect.objectContaining({ id: 'b', status: 'error' }),
      expect.objectContaining({ id: 'missing', status: 'error' }),
    ]);
  });

  it('cancels each ok-eligible run and emits per-item audit', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'a', namespace: 'team-alpha', status: 'running' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'b', namespace: 'team-alpha', status: 'paused' }),
    );
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    await bulkCancelRuns({ runIds: ['a', 'b'] }, scope);

    const eventsA = await auditRepo.getByProcess('a');
    const eventsB = await auditRepo.getByProcess('b');
    expect(eventsA.map((e) => e.action)).toEqual(['instance.cancelled']);
    expect(eventsB.map((e) => e.action)).toEqual(['instance.cancelled']);
  });

  it('foreign-workspace ids surface as error not_found (anti-enum)', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'a', namespace: 'team-beta', status: 'running' }),
    );
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { results } = await bulkCancelRuns({ runIds: ['a'] }, scope);

    expect(results[0]).toMatchObject({ id: 'a', status: 'error' });
  });
});

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
