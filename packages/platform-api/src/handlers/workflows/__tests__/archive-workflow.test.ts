import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { archiveWorkflow } from '../archive-workflow.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

describe('archiveWorkflow handler', () => {
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

  it('archiveWorkflow flips the archived flag and emits workflow.archived audit', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope();

    const result = await archiveWorkflow(
      { name: 'flow-a', namespace: 'team-alpha', archived: true },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'flow-a', archived: true });
    const stored = await processRepo.getWorkflowDefinition('team-alpha', 'flow-a', 1);
    expect(stored?.archived).toBe(true);
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.archived');
    expect(events[0].actorId).toBe('user-42');
    expect(events[0].actorType).toBe('user');
    expect(events[0].entityType).toBe('workflow_definition');
    expect(events[0].entityId).toBe('flow-a');
  });
});
