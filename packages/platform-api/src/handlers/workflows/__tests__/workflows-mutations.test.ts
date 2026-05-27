import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { archiveWorkflow } from '../archive-workflow.js';
import { deleteWorkflow } from '../delete-workflow.js';
import { registerWorkflow } from '../register-workflow.js';
import { setDefaultWorkflowVersion } from '../set-default-version.js';
import { setWorkflowVisibility } from '../set-visibility.js';
import { transferWorkflowNamespace } from '../transfer-workflow.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { ForbiddenError } from '../../../errors.js';

describe('workflow mutation handlers', () => {
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
