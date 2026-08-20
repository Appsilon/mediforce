import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
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
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      instanceRepo,
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

  it('cascades runs only inside the deleted workflow’s workspace', async () => {
    // `InMemoryProcessRepository` holds definitions only, so its run count is
    // a flat 0 — the handler would skip the cascade entirely and the test
    // would pass without exercising it. Count from the instance store instead.
    processRepo.countInstancesByDefinitionName = async (namespace, name) =>
      (await instanceRepo.getIdsByDefinitionName(namespace, name)).length;
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'shared-name', version: 1, namespace: 'team-alpha' }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'shared-name', version: 1, namespace: 'team-beta' }),
    );
    const mine = await instanceRepo.create(
      buildProcessInstance({ definitionName: 'shared-name', namespace: 'team-alpha' }),
    );
    const theirs = await instanceRepo.create(
      buildProcessInstance({ definitionName: 'shared-name', namespace: 'team-beta' }),
    );
    const scope = buildScope(['team-alpha', 'team-beta']);

    await deleteWorkflow(
      { name: 'shared-name', namespace: 'team-alpha', expectedRunCount: 1 },
      scope,
    );

    // Workflow names are unique per workspace, not globally — an unscoped
    // cascade would tombstone a stranger's runs that happen to share a name.
    expect((await instanceRepo.getById(mine.id))?.deleted).toBe(true);
    expect((await instanceRepo.getById(theirs.id))?.deleted).not.toBe(true);
  });
});
