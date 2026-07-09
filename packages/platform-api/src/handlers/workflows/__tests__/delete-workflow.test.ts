import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { deleteWorkflow } from '../delete-workflow';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('deleteWorkflow handler', () => {
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

  it('deleteWorkflow soft-deletes the workflow and cascades to runs + tasks', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-del', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope();

    const result = await deleteWorkflow(
      { name: 'flow-del', namespace: 'team-alpha', expectedRunCount: 0 },
      scope,
    );

    expect(result).toEqual({ success: true, deletedRuns: 0 });
    const isDeleted = await processRepo.isWorkflowNameDeleted('team-alpha', 'flow-del');
    expect(isDeleted).toBe(true);
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.delete');
    expect(events[0].actorId).toBe('user-42');
    expect(events[0].entityId).toBe('flow-del');
  });
});
