import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getWorkflowStatusCounts } from '../get-workflow-status-counts';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('getWorkflowStatusCounts handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    await instanceRepo.create(buildProcessInstance({ id: 'r-running', status: 'running' }));
    await instanceRepo.create(buildProcessInstance({ id: 'r-completed', status: 'completed' }));
    await instanceRepo.create(
      buildProcessInstance({ id: 'r-waiting', status: 'paused', pauseReason: 'waiting_for_human' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'r-error', status: 'paused', pauseReason: 'missing_env' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'r-cancelled', status: 'failed', error: 'Cancelled by user' }),
    );
  });

  it('returns counts per WorkflowDisplayStatus bucket, matching getWorkflowStatus exactly', async () => {
    const scope = createTestScope({ instanceRepo });
    const result = await getWorkflowStatusCounts({}, scope);

    expect(result.counts).toEqual({
      in_progress: 1,
      waiting_for_human: 1,
      error: 1,
      cancelled: 1,
      completed: 1,
    });
  });

  it('respects the archived filter — excluded by default', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r-archived', status: 'running', archived: true }),
    );
    const scope = createTestScope({ instanceRepo });

    const withoutArchived = await getWorkflowStatusCounts({}, scope);
    expect(withoutArchived.counts.in_progress).toBe(1);

    const withArchived = await getWorkflowStatusCounts({ archived: true }, scope);
    expect(withArchived.counts.in_progress).toBe(2);
  });

  it('scopes to the user caller\'s namespaces', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r-other-ns', namespace: 'other', status: 'running' }),
    );
    const scope = createTestScope({ instanceRepo, caller: userCaller('u-1', ['test']) });

    const result = await getWorkflowStatusCounts({}, scope);
    expect(result.counts.in_progress).toBe(1);
  });
});
