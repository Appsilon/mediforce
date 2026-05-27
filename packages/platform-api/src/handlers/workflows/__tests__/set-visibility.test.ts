import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { setWorkflowVisibility } from '../set-visibility.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

describe('setWorkflowVisibility handler', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  it('setWorkflowVisibility changes visibility and emits workflow.visibility_changed audit', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-vis',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'private',
      }),
    );
    const scope = buildScope();

    const result = await setWorkflowVisibility(
      { name: 'flow-vis', namespace: 'team-alpha', visibility: 'public' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'flow-vis', visibility: 'public' });
    const stored = await processRepo.getWorkflowDefinition('team-alpha', 'flow-vis', 1);
    expect(stored?.visibility).toBe('public');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.visibility_changed');
    expect(events[0].actorId).toBe('user-42');
  });
});
