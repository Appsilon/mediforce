import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { transferWorkflowNamespace } from '../transfer-workflow';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { ForbiddenError } from '../../../errors';

describe('transferWorkflowNamespace handler', () => {
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

  it('transferWorkflowNamespace moves the workflow and emits workflow.transferred audit', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-move', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope(['team-alpha', 'team-beta']);

    const result = await transferWorkflowNamespace(
      { name: 'flow-move', sourceNamespace: 'team-alpha', targetNamespace: 'team-beta' },
      scope,
    );

    expect(result).toEqual({
      success: true,
      name: 'flow-move',
      sourceNamespace: 'team-alpha',
      targetNamespace: 'team-beta',
    });
    const movedSource = await processRepo.getWorkflowDefinition('team-alpha', 'flow-move', 1);
    expect(movedSource).toBeNull();
    const movedTarget = await processRepo.getWorkflowDefinition('team-beta', 'flow-move', 1);
    expect(movedTarget?.namespace).toBe('team-beta');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.transferred');
    expect(events[0].actorId).toBe('user-42');
  });

  it('transferWorkflowNamespace rejects when caller lacks membership on the source namespace', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-src-only', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope(['team-beta']);

    const err = await transferWorkflowNamespace(
      { name: 'flow-src-only', sourceNamespace: 'team-alpha', targetNamespace: 'team-beta' },
      scope,
    ).catch((caught) => caught);

    expect(err).toBeInstanceOf(ForbiddenError);
    const stillAtSource = await processRepo.getWorkflowDefinition('team-alpha', 'flow-src-only', 1);
    expect(stillAtSource).not.toBeNull();
    expect(auditRepo.getAll()).toHaveLength(0);
  });

  it('transferWorkflowNamespace rejects when caller lacks membership on the target namespace', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-tgt-only', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope(['team-alpha']);

    const err = await transferWorkflowNamespace(
      { name: 'flow-tgt-only', sourceNamespace: 'team-alpha', targetNamespace: 'team-beta' },
      scope,
    ).catch((caught) => caught);

    expect(err).toBeInstanceOf(ForbiddenError);
    const stillAtSource = await processRepo.getWorkflowDefinition('team-alpha', 'flow-tgt-only', 1);
    expect(stillAtSource).not.toBeNull();
    expect(auditRepo.getAll()).toHaveLength(0);
  });
});
