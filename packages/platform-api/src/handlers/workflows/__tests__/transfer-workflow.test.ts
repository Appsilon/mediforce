import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
  InMemoryUserDirectoryService,
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
  let triggerRepo: InMemoryTriggerRepository;
  let directory: InMemoryUserDirectoryService;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    triggerRepo = new InMemoryTriggerRepository();
    directory = new InMemoryUserDirectoryService();
  });

  function buildScope(namespaces = ['team-alpha']) {
    return createTestScope({
      processRepo,
      auditRepo,
      triggerRepo,
      userDirectory: directory,
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

  it('transferWorkflowNamespace moves the workflow’s trigger rows with the definition', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-move', version: 1, namespace: 'team-alpha' }),
    );
    await triggerRepo.create({
      type: 'cron',
      namespace: 'team-alpha',
      workflowName: 'flow-move',
      name: 'nightly',
      enabled: true,
      config: { schedule: '0 3 * * *' },
      lastTriggeredAt: '2026-07-01T03:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const scope = buildScope(['team-alpha', 'team-beta']);

    await transferWorkflowNamespace(
      { name: 'flow-move', sourceNamespace: 'team-alpha', targetNamespace: 'team-beta' },
      scope,
    );

    expect(await triggerRepo.listByWorkflow('team-alpha', 'flow-move')).toEqual([]);
    const moved = await triggerRepo.listByWorkflow('team-beta', 'flow-move');
    expect(moved).toHaveLength(1);
    expect(moved[0].namespace).toBe('team-beta');
    expect(moved[0].name).toBe('nightly');
    // Enabled state and fire cursor survive the move so the schedule is intact.
    expect(moved[0].enabled).toBe(true);
    expect(moved[0].type === 'cron' && moved[0].lastTriggeredAt).toBe('2026-07-01T03:00:00.000Z');
  });

  it('transferWorkflowNamespace drops role grants narrowed to the workflow it moves out', async () => {
    // ADR-0019: the source name is free again after the move. A grant left
    // pointing at it is invisible until someone registers that name, and then
    // hands them a reviewer nobody granted. Grants do not follow the workflow
    // either — the holders need not be members of the target workspace.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-move', version: 1, namespace: 'team-alpha' }),
    );
    directory.addUser({ uid: 'user-7', email: 'seven@x.test' });
    directory.addRole('user-7', 'team-alpha', 'approver', 'flow-move');
    directory.addRole('user-7', 'team-alpha', 'reviewer', null);
    const scope = buildScope(['team-alpha', 'team-beta']);

    await transferWorkflowNamespace(
      { name: 'flow-move', sourceNamespace: 'team-alpha', targetNamespace: 'team-beta' },
      scope,
    );

    // The narrowed grant is gone; the workspace-wide one was never about this
    // workflow and stays. Nothing was created in the target.
    expect(await directory.getRolesForUser('user-7', 'team-alpha')).toEqual(['reviewer']);
    expect(await directory.getRolesForUser('user-7', 'team-beta')).toEqual([]);
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
