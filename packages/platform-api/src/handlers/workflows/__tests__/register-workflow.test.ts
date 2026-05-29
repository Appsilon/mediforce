import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { registerWorkflow } from '../register-workflow';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('registerWorkflow handler', () => {
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

  it('registerWorkflow stores a new workflow and emits workflow.created audit', async () => {
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'flow-new',
      namespace: 'team-alpha',
    });
    const { version: _omitVersion, createdAt: _omitCreatedAt, namespace: _omitNamespace, ...input } = body;

    const result = await registerWorkflow(
      { ...input, namespace: 'team-alpha' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'flow-new', version: 1 });
    const stored = await processRepo.getWorkflowDefinition('team-alpha', 'flow-new', 1);
    expect(stored?.name).toBe('flow-new');
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.created');
    expect(events[0].actorId).toBe('user-42');
  });

  it('registerWorkflow bumps version and emits workflow.version_added audit when name already exists', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-existing', version: 1, namespace: 'team-alpha' }),
    );
    const scope = buildScope();
    const body = buildWorkflowDefinition({
      name: 'flow-existing',
      namespace: 'team-alpha',
    });
    const { version: _omitVersion, createdAt: _omitCreatedAt, namespace: _omitNamespace, ...input } = body;

    const result = await registerWorkflow(
      { ...input, namespace: 'team-alpha' },
      scope,
    );

    expect(result).toEqual({ success: true, name: 'flow-existing', version: 2 });
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.version_added');
  });
});
