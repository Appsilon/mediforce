import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { setDefaultWorkflowVersion } from '../set-default-version.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';

describe('setDefaultWorkflowVersion handler', () => {
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

  it('setDefaultWorkflowVersion sets the default version and emits workflow.default_version_changed audit', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-default', version: 1, namespace: 'team-alpha' }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-default', version: 2, namespace: 'team-alpha' }),
    );
    const scope = buildScope();

    const result = await setDefaultWorkflowVersion(
      { name: 'flow-default', namespace: 'team-alpha', version: 2 },
      scope,
    );

    expect(result).toEqual({
      success: true,
      name: 'flow-default',
      namespace: 'team-alpha',
      version: 2,
    });
    const defaultVersion = await processRepo.getDefaultWorkflowVersion('team-alpha', 'flow-default');
    expect(defaultVersion).toBe(2);
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('workflow.default_version_changed');
    expect(events[0].actorId).toBe('user-42');
  });
});
