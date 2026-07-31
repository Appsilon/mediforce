import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { listRunsPage } from '../list-runs-page';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listRunsPage handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  it('returns the newest-first page and a nextCursor when more rows remain', async () => {
    for (let i = 0; i < 3; i++) {
      await instanceRepo.create(
        buildProcessInstance({
          id: `r${i}`,
          namespace: 'alpha',
          createdAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        }),
      );
    }

    const scope = createTestScope({ instanceRepo });
    const result = await listRunsPage({ namespace: 'alpha', limit: 2 }, scope);

    expect(result.runs.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(result.nextCursor).toBeDefined();

    const nextPage = await listRunsPage(
      { namespace: 'alpha', limit: 2, cursor: result.nextCursor },
      scope,
    );
    expect(nextPage.runs.map((r) => r.id)).toEqual(['r0']);
    expect(nextPage.nextCursor).toBeUndefined();
  });

  it('excludes archived runs by default and includes them when archived=true', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'active', archived: false }));
    await instanceRepo.create(buildProcessInstance({ id: 'archived-1', archived: true }));

    const scope = createTestScope({ instanceRepo });

    const defaultResult = await listRunsPage({ limit: 20 }, scope);
    expect(defaultResult.runs.map((r) => r.id)).toEqual(['active']);

    const withArchived = await listRunsPage({ limit: 20, archived: true }, scope);
    expect(withArchived.runs.map((r) => r.id).sort()).toEqual(['active', 'archived-1']);
  });

  it('filters by displayStatus (waiting_for_human), not the raw status column', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'waiting', status: 'paused', pauseReason: 'waiting_for_human' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'errored', status: 'paused', pauseReason: 'missing_env' }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await listRunsPage({ limit: 20, displayStatus: 'waiting_for_human' }, scope);

    expect(result.runs.map((r) => r.id)).toEqual(['waiting']);
  });

  it('scopes to the user caller\'s namespaces', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r-alpha', namespace: 'alpha' }));
    await instanceRepo.create(buildProcessInstance({ id: 'r-beta', namespace: 'beta' }));

    const scope = createTestScope({ instanceRepo, caller: userCaller('u-1', ['alpha']) });
    const result = await listRunsPage({ limit: 20 }, scope);

    expect(result.runs.map((r) => r.id)).toEqual(['r-alpha']);
  });
});
