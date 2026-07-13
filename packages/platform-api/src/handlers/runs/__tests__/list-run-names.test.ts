import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listRunNames } from '../list-run-names';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listRunNames handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  it('returns projected { id, definitionName } entries for the namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf-a' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'r2', namespace: 'alpha', definitionName: 'wf-b' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'r3', namespace: 'beta', definitionName: 'wf-c' }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await listRunNames({ namespace: 'alpha' }, scope);

    expect(result.runs).toEqual([
      { id: 'r1', definitionName: 'wf-a' },
      { id: 'r2', definitionName: 'wf-b' },
    ]);
  });

  it('returns only the two projected fields, never the full ProcessInstance shape', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf', variables: { x: 1 } }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await listRunNames({ namespace: 'alpha' }, scope);

    expect(Object.keys(result.runs[0]).sort()).toEqual(['definitionName', 'id']);
  });

  it('returns entries for a user caller who is a member of the namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf' }),
    );

    const scope = createTestScope({ instanceRepo, caller: userCaller('u-1', ['alpha']) });
    const result = await listRunNames({ namespace: 'alpha' }, scope);

    expect(result.runs.map((r) => r.id)).toEqual(['r1']);
  });

  it('returns empty when the user caller is not a member of the namespace', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf' }),
    );

    const scope = createTestScope({ instanceRepo, caller: userCaller('u-2', ['gamma']) });
    const result = await listRunNames({ namespace: 'alpha' }, scope);

    expect(result.runs).toEqual([]);
  });

  it('excludes soft-deleted runs', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'live', namespace: 'alpha', definitionName: 'wf' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'gone', namespace: 'alpha', definitionName: 'wf', deleted: true }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await listRunNames({ namespace: 'alpha' }, scope);

    expect(result.runs.map((r) => r.id)).toEqual(['live']);
  });
});
