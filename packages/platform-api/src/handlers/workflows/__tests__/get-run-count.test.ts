import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProcessRepository, resetFactorySequence } from '@mediforce/platform-core/testing';
import { getWorkflowRunCount } from '../get-run-count';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('getWorkflowRunCount handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      caller: userCaller('u-1', namespaces),
    });
  }

  it('returns the instance count for a workflow the caller can see', async () => {
    const scope = buildScope();
    const result = await getWorkflowRunCount({ namespace: 'team-alpha', name: 'flow-x' }, scope);
    expect(result).toEqual({ count: 0 });
  });

  it('returns 0 when caller lacks membership on the namespace (no enumeration leak)', async () => {
    const scope = buildScope(['team-alpha']);
    const result = await getWorkflowRunCount({ namespace: 'team-foreign', name: 'flow-x' }, scope);
    expect(result).toEqual({ count: 0 });
  });
});
