import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listRuns } from '../list-runs.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('listRuns handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  it('returns every run for an api-key caller, mapped to the wire shape', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'r2', namespace: 'beta', definitionName: 'wf' }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await listRuns({ limit: 20 }, scope);

    expect(result.runs.map((r) => r.runId).sort()).toEqual(['r1', 'r2']);
    expect(result.runs[0]).toMatchObject({
      runId: expect.any(String),
      status: expect.any(String),
      definitionName: 'wf',
      error: null,
    });
  });

  it('filters by workflow name', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r1', definitionName: 'a' }));
    await instanceRepo.create(buildProcessInstance({ id: 'r2', definitionName: 'b' }));

    const scope = createTestScope({ instanceRepo });
    const result = await listRuns({ workflow: 'a', limit: 20 }, scope);

    expect(result.runs.map((r) => r.runId)).toEqual(['r1']);
  });

  it('returns only runs in the user caller’s namespaces', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r-alpha', namespace: 'alpha' }));
    await instanceRepo.create(buildProcessInstance({ id: 'r-beta', namespace: 'beta' }));
    await instanceRepo.create(buildProcessInstance({ id: 'r-orphan', namespace: undefined }));

    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-1', ['alpha']),
    });
    const result = await listRuns({ limit: 20 }, scope);

    expect(result.runs.map((r) => r.runId)).toEqual(['r-alpha']);
  });

  it('returns empty when the user has no namespace overlap', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha' }));

    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-2', ['gamma']),
    });
    const result = await listRuns({ limit: 20 }, scope);

    expect(result.runs).toEqual([]);
  });

  it('omits totalCostUsd when absent on the instance', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r1' }));

    const scope = createTestScope({ instanceRepo });
    const result = await listRuns({ limit: 20 }, scope);

    expect(result.runs[0]).not.toHaveProperty('totalCostUsd');
  });

  it('includes totalCostUsd when set on the instance', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r1', totalCostUsd: 1.5 }));

    const scope = createTestScope({ instanceRepo });
    const result = await listRuns({ limit: 20 }, scope);

    expect(result.runs[0].totalCostUsd).toBe(1.5);
  });
});
