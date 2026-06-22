import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { copyWorkflow } from '../copy-workflow';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ConflictError, NotFoundError } from '../../../errors';

describe('copyWorkflow handler', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function buildScope(namespaces = ['team-alpha', 'team-beta']) {
    return createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  it('copies a workflow into the target namespace at version 1 and emits workflow.copied audit', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-src',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'private',
      }),
    );
    const scope = buildScope();

    const result = await copyWorkflow(
      {
        name: 'flow-src',
        sourceNamespace: 'team-alpha',
        targetNamespace: 'team-beta',
      },
      scope,
    );

    expect(result).toMatchObject({
      success: true,
      name: 'flow-src',
      version: 1,
      copiedFrom: { namespace: 'team-alpha', name: 'flow-src', version: 1 },
    });
    const target = await processRepo.getWorkflowDefinition('team-beta', 'flow-src', 1);
    expect(target?.namespace).toBe('team-beta');
    expect(target?.visibility).toBe('private');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.copied');
  });

  it('throws NotFoundError when source workflow is missing', async () => {
    const scope = buildScope();
    const err = await copyWorkflow(
      {
        name: 'missing',
        sourceNamespace: 'team-alpha',
        targetNamespace: 'team-beta',
      },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when the target name already exists', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-src', version: 1, namespace: 'team-alpha' }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-src', version: 1, namespace: 'team-beta' }),
    );
    const scope = buildScope();

    const err = await copyWorkflow(
      {
        name: 'flow-src',
        sourceNamespace: 'team-alpha',
        targetNamespace: 'team-beta',
      },
      scope,
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
  });
});
