import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProcessInstanceRepository } from '../in-memory-process-instance-repository';
import { buildProcessInstance, resetFactorySequence } from '../factories';

describe('InMemoryProcessInstanceRepository.listDefinitionNames', () => {
  let repo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    repo = new InMemoryProcessInstanceRepository();
  });

  it('returns only the projected { id, definitionName } shape', async () => {
    await repo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'wf-a' }));

    const entries = await repo.listDefinitionNames('alpha');

    expect(entries).toEqual([{ id: 'r1', definitionName: 'wf-a' }]);
    expect(Object.keys(entries[0]).sort()).toEqual(['definitionName', 'id']);
  });

  it('scopes to the requested namespace', async () => {
    await repo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha', definitionName: 'a' }));
    await repo.create(buildProcessInstance({ id: 'r2', namespace: 'beta', definitionName: 'b' }));

    const entries = await repo.listDefinitionNames('alpha');

    expect(entries.map((e) => e.id)).toEqual(['r1']);
  });

  it('excludes soft-deleted runs', async () => {
    await repo.create(buildProcessInstance({ id: 'live', namespace: 'alpha', definitionName: 'a' }));
    await repo.create(buildProcessInstance({ id: 'gone', namespace: 'alpha', definitionName: 'a', deleted: true }));

    const entries = await repo.listDefinitionNames('alpha');

    expect(entries.map((e) => e.id)).toEqual(['live']);
  });

  it('has no limit — returns every matching run', async () => {
    for (let i = 0; i < 50; i += 1) {
      await repo.create(buildProcessInstance({ id: `r${String(i)}`, namespace: 'alpha', definitionName: 'a' }));
    }

    const entries = await repo.listDefinitionNames('alpha');

    expect(entries).toHaveLength(50);
  });
});
